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
    // SECURITY FIX: Validate tenant exists before auto-creating a courier record.
    // Previously any random tenantId from the URL would create a DB document.
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
  
  if (courier && courier.apiSecret) {
    const doc = courier.toObject();
    try {
      const decrypted = decryptText(doc.apiSecret as string);
      const visibleCount = 6;
      if (decrypted.length > visibleCount) {
        doc.apiSecret = '*'.repeat(16) + decrypted.slice(-visibleCount);
      } else {
        doc.apiSecret = '*'.repeat(16);
      }
    } catch (e) {
      doc.apiSecret = '*'.repeat(16);
    }
    return doc as ICourier;
  }
  
  return courier as ICourier;
};

const updateCourierCharge = async (tenantId: string, payload: Partial<ICourier>): Promise<ICourier | null> => {
  const result = await Courier.findOneAndUpdate(
    { tenantId },
    { $set: payload },
    { returnDocument: 'after', upsert: true } // upsert ensures it creates if it doesn't exist during update
  );
  return result;
};

const saveCredentials = async (tenantId: string, payload: Partial<ICourier>): Promise<ICourier | null> => {
  if (payload.apiSecret && !payload.apiSecret.includes('***')) {
    payload.apiSecret = encryptText(payload.apiSecret);
  } else {
    // Do not overwrite existing secret if blank or masked
    delete payload.apiSecret;
  }
  
  const result = await Courier.findOneAndUpdate(
    { tenantId },
    { $set: payload },
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
  if (!courierConfig || !courierConfig.provider || courierConfig.provider !== providerId) {
    throw new CustomError(400, `Courier provider ${providerId} is not configured`);
  }

  if (!courierConfig.clientId || !courierConfig.apiSecret) {
    throw new CustomError(400, 'Courier credentials are missing');
  }

  const clientId = courierConfig.clientId;
  const apiSecret = decryptText(courierConfig.apiSecret);

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
