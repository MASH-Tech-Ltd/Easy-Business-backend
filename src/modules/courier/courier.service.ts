import { Courier } from './courier.model';
import { ICourier } from './courier.interface';
import { encryptText, decryptText } from '../../utils/encryption';
import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';
import { Order } from '../order/order.model';
import { PathaoProvider } from './providers/PathaoProvider';
import { SteadfastProvider } from './providers/SteadfastProvider';
import { RedxProvider } from './providers/RedxProvider';
import CustomError from '../../helpers/CustomError';
import { Addon } from '../addon/addon.model';

const getCourierChargeByTenant = async (tenantId: string): Promise<ICourier> => {
  let courier = await Courier.findOne({ tenantId });
  if (!courier) {
    const tenantExists = await Tenant.exists({ _id: tenantId, status: 'active' });
    if (!tenantExists) {
      throw new CustomError(404, 'Tenant not found');
    }
    courier = await Courier.findOneAndUpdate(
      { tenantId },
      { $setOnInsert: { tenantId, insideDhaka: 60, outsideDhaka: 120 } },
      { upsert: true, returnDocument: 'after' }
    );
  }
  
  if (courier) {
    const doc = courier.toObject();
    
    // Process API Secret Masking (Legacy)
    if (doc.apiSecret) {
      try {
        const decrypted = decryptText(doc.apiSecret as string);
        doc.apiSecret = '•'.repeat(12) + decrypted.slice(-4);
      } catch (e) {
        doc.apiSecret = '•'.repeat(16);
      }
    }
    
    // Process Client ID (API Key) Masking for Steadfast (Legacy)
    if (doc.clientId && doc.provider === 'steadfast') {
      try {
        const decryptedClientId = decryptText(doc.clientId as string);
        doc.clientId = '•'.repeat(12) + decryptedClientId.slice(-4);
      } catch (e) {
        doc.clientId = '•'.repeat(16);
      }
    } else if (doc.clientId) {
      try { doc.clientId = decryptText(doc.clientId as string); } catch(e) {}
    }

    // Process all providers
    if (doc.providers) {
      for (const [key, p] of Object.entries(doc.providers) as any) {
        if (p.apiSecret) {
          try {
            const decrypted = decryptText(p.apiSecret);
            p.apiSecret = '•'.repeat(12) + decrypted.slice(-4);
          } catch (e) {
            p.apiSecret = '•'.repeat(16);
          }
        }
        if (p.clientId) {
          if (key === 'steadfast') {
            try {
              const decrypted = decryptText(p.clientId);
              p.clientId = '•'.repeat(12) + decrypted.slice(-4);
            } catch (e) {
              p.clientId = '•'.repeat(16);
            }
          } else {
            try { p.clientId = decryptText(p.clientId); } catch (e) {}
          }
        }
      }
    }

    return doc as ICourier;
  }
  
  return courier as unknown as ICourier;
};

const updateCourierCharge = async (tenantId: string, payload: Partial<ICourier>): Promise<ICourier | null> => {
  const result = await Courier.findOneAndUpdate(
    { tenantId },
    { $set: payload },
    { returnDocument: 'after', upsert: true } // upsert ensures it creates if it doesn't exist during update
  );
  return result;
};

const saveCredentials = async (tenantId: string, payload: any): Promise<ICourier | null> => {
  const { provider, clientId, apiSecret, autoForward, isActive = true } = payload;
  const updateDoc: any = {};

  let finalClientId = clientId;
  if (clientId && !clientId.includes('•••') && !clientId.includes('***')) {
    finalClientId = encryptText(clientId);
  }
  let finalApiSecret = apiSecret;
  if (apiSecret && !apiSecret.includes('•••') && !apiSecret.includes('***')) {
    finalApiSecret = encryptText(apiSecret);
  }

  if (provider) {
    if (finalClientId !== undefined && !clientId?.includes('•••') && !clientId?.includes('***')) {
      updateDoc[`providers.${provider}.clientId`] = finalClientId;
      updateDoc.clientId = finalClientId; // Legacy fallback
    }
    if (finalApiSecret !== undefined && !apiSecret?.includes('•••') && !apiSecret?.includes('***')) {
      updateDoc[`providers.${provider}.apiSecret`] = finalApiSecret;
      updateDoc.apiSecret = finalApiSecret; // Legacy fallback
    }
    if (autoForward !== undefined) {
      updateDoc[`providers.${provider}.autoForward`] = autoForward;
      updateDoc.autoForward = autoForward; // Legacy fallback
    }
    updateDoc[`providers.${provider}.isActive`] = isActive;
    if (isActive) updateDoc.provider = provider;
  }

  const result = await Courier.findOneAndUpdate(
    { tenantId },
    { $set: updateDoc },
    { returnDocument: 'after', upsert: true }
  );
  return result;
};

const getAllCredentials = async () => {
  const couriers = await Courier.find().populate('tenantId', 'name slug');
  
  // Decrypt the secrets before returning for SuperAdmin
  return couriers.map((c) => {
    const doc = c.toObject();
    if (doc.apiSecret) {
      doc.apiSecret = decryptText(doc.apiSecret);
    }
    return doc;
  });
};

const checkCourierAddonLimit = async (tenantId: string) => {
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('purchasedAddons.addonId');
  if (!subscription || !subscription.purchasedAddons) {
    throw new CustomError(403, 'No active add-ons found for this subscription');
  }

  const courierAddon = subscription.purchasedAddons.find(
    (pa: any) => pa.addonId?.slug === 'courier_automation' && pa.status === 'active'
  );

  if (!courierAddon) {
    const addonInfo = await Addon.findOne({ slug: 'courier_automation' });
    throw new CustomError(403, 'Courier Automation add-on is not active or purchased for this subscription', {
      addonId: addonInfo?._id,
      addonSlug: 'courier_automation'
    });
  }

  if (courierAddon.used >= courierAddon.limit) {
    throw new CustomError(403, 'Courier Automation limit reached. Please upgrade your add-on.');
  }

  const courierConfig = await Courier.findOne({ tenantId });
  return { allowed: true, configuredProvider: courierConfig?.provider };
};

const forwardOrder = async (orderId: string, tenantId: string, providerId: string) => {
  // 1. Check add-on limits
  const { allowed } = await checkCourierAddonLimit(tenantId);
  
  // 2. Fetch order
  const order = await Order.findOne({ _id: orderId, tenantId });
  if (!order) {
    throw new CustomError(404, 'Order not found');
  }
  if (order.consignmentId) {
    throw new CustomError(400, 'Order is already forwarded to a courier');
  }

  // 3. Get Credentials
  const courierConfig = await Courier.findOne({ tenantId });
  
  let pConfig: any = null;
  if (courierConfig?.providers && (courierConfig.providers as Record<string, any>)[providerId]) {
    pConfig = (courierConfig.providers as Record<string, any>)[providerId];
  } else if (courierConfig?.provider === providerId) {
    pConfig = { clientId: courierConfig.clientId, apiSecret: courierConfig.apiSecret, isActive: true };
  }

  if (!pConfig || !pConfig.isActive) {
    throw new CustomError(400, `Courier provider ${providerId} is not configured or active`);
  }

  if (!pConfig.clientId || !pConfig.apiSecret) {
    throw new CustomError(400, `Courier credentials for ${providerId} are missing`);
  }

  let clientId = pConfig.clientId;
  let apiSecret = pConfig.apiSecret;
  
  try { clientId = decryptText(clientId); } catch(e) {}
  try { apiSecret = decryptText(apiSecret); } catch(e) {}

  // 4. Create Order on Provider
  let result;
  if (providerId === 'pathao') {
    const provider = new PathaoProvider(clientId, apiSecret);
    result = await provider.createOrder(order);
  } else if (providerId === 'steadfast') {
    const provider = new SteadfastProvider(clientId, apiSecret);
    result = await provider.createOrder(order);
  } else if (providerId === 'redx') {
    const provider = new RedxProvider(clientId, apiSecret);
    result = await provider.createOrder(order);
  } else {
    throw new CustomError(400, 'Unsupported courier provider');
  }

  // 5. Update Order
  order.consignmentId = result.consignmentId;
  order.trackingUrl = result.trackingUrl;
  order.courierProvider = providerId;
  order.status = 'shipped'; // Automatically mark as shipped? (Optional, kept original status logic unless asked)
  await order.save();

  // 6. Increment Usage
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('purchasedAddons.addonId');
  if (subscription && subscription.purchasedAddons) {
    const courierAddon = subscription.purchasedAddons.find(
      (pa: any) => pa.addonId?.slug === 'courier_automation' && pa.status === 'active'
    );
    if (courierAddon) {
      courierAddon.used += 1;
      await subscription.save();
    }
  }

  return { consignmentId: result.consignmentId, trackingUrl: result.trackingUrl, status: 'success' };
};

export const CourierService = {
  getCourierChargeByTenant,
  updateCourierCharge,
  saveCredentials,
  getAllCredentials,
  checkCourierAddonLimit,
  forwardOrder,
};
