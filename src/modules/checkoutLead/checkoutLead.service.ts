import { CheckoutLead } from './checkoutLead.model';
import { ICheckoutLead } from './checkoutLead.interface';
import { Subscription } from '../subscription/subscription.model';
import { syncSubscriptionAddonCredits } from '../subscription/subscription.service';
import CustomError from '../../helpers/CustomError';
import { Types } from 'mongoose';

const sanitizeLeadItems = (rawItems: unknown) => {
  if (!Array.isArray(rawItems)) return undefined;
  return rawItems
    .slice(0, 50)
    .filter((item): item is Record<string, any> => !!item && typeof item === 'object' && !!item.title)
    .map((item) => ({
      productId: item.productId ? String(item.productId) : item.id ? String(item.id) : undefined,
      title: String(item.title).trim().slice(0, 200),
      price: typeof item.price === 'number' && item.price >= 0 ? item.price : Number(item.price) || 0,
      quantity: Math.max(1, Math.min(999, Number(item.quantity) || 1)),
      image: typeof item.image === 'string' ? item.image.trim() : undefined,
      color: typeof item.color === 'string' ? item.color.trim() : undefined,
      size: typeof item.size === 'string' ? item.size.trim() : undefined,
    }));
};

const trackLead = async (tenantId: string, payload: Partial<ICheckoutLead> & { leadId?: string }) => {
  const { leadId, ...restPayload } = payload as any;
  const sanitizedItems = sanitizeLeadItems(restPayload.items);
  const cleanPayload: Partial<ICheckoutLead> = {
    ...restPayload,
    ...(sanitizedItems
      ? {
          items: sanitizedItems,
          subTotal: sanitizedItems.reduce(
            (sum, it) => sum + (it.price || 0) * (it.quantity || 1),
            0
          ),
        }
      : {}),
  };
  // Check addon active status and limit
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('purchasedAddons.addonId');
  if (!subscription || !subscription.purchasedAddons) return null; // Silently fail if no subscription

  // Ensure monthly free credits are in sync with current entitlement cycle
  await syncSubscriptionAddonCredits(subscription);

  const addonIndex = subscription.purchasedAddons.findIndex(
    (pa: any) => pa.addonId?.slug === 'abandoned_checkout' && pa.isActive
  );

  if (addonIndex === -1) return null; // Addon not active
  const addonInfo = subscription.purchasedAddons[addonIndex];
  if (!addonInfo) return null;

  const deductUsage = async () => {
    const freeRem = (addonInfo.freeLimit || 0) - (addonInfo.freeUsed || 0);
    if (freeRem > 0) {
      addonInfo.freeUsed = (addonInfo.freeUsed || 0) + 1;
    } else {
      addonInfo.paidUsed = (addonInfo.paidUsed || 0) + 1;
    }
    addonInfo.used = (addonInfo.freeUsed || 0) + (addonInfo.paidUsed || 0);
    subscription.markModified('purchasedAddons');
    await subscription.save();
  };

  // First try to match by leadId (so editing phone/email/name/address updates the exact same lead)
  let existingLead = null;
  if (leadId && Types.ObjectId.isValid(leadId)) {
    existingLead = await CheckoutLead.findOne({ _id: leadId, tenantId, status: 'abandoned' });
  }

  // Fallback: match by phone or email in this tenant
  if (!existingLead) {
    const query: any = { tenantId, status: 'abandoned' };

    if (cleanPayload.phone && cleanPayload.email) {
      query.$or = [{ phone: cleanPayload.phone }, { email: cleanPayload.email }];
    } else if (cleanPayload.phone) {
      query.phone = cleanPayload.phone;
    } else if (cleanPayload.email) {
      query.email = cleanPayload.email;
    } else {
      // If no phone or email, we just create a new one, checking limit first.
      if (addonInfo.used >= addonInfo.limit) return null; // Limit reached
      await deductUsage();
      return await CheckoutLead.create({ ...cleanPayload, tenantId });
    }

    existingLead = await CheckoutLead.findOne(query).sort({ createdAt: -1 });
  }

  if (existingLead) {
    // Update existing lead with new info (does not consume a limit point)
    Object.assign(existingLead, cleanPayload);
    return await existingLead.save();
  } else {
    // Create new lead, must check limit
    if (addonInfo.used >= addonInfo.limit) return null; // Limit reached
    await deductUsage();
    return await CheckoutLead.create({ ...cleanPayload, tenantId });
  }
};

const getMerchantLeads = async (tenantId: string, query: any) => {
  // Check if tenant has the 'abandoned_checkout' addon active
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('purchasedAddons.addonId');
  
  if (!subscription || !subscription.purchasedAddons) {
    throw new CustomError(403, 'Subscription not found or no addons purchased');
  }

  await syncSubscriptionAddonCredits(subscription);

  const addonInfo = subscription.purchasedAddons.find(
    (pa: any) => pa.addonId?.slug === 'abandoned_checkout' && pa.isActive
  );

  if (!addonInfo) {
    throw new CustomError(403, 'Abandoned Checkout add-on is not active or purchased for this subscription');
  }

  const limitReached = addonInfo.used >= addonInfo.limit;

  const { page = 1, limit = 10, search = '', status = 'all' } = query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = { tenantId };
  if (status === 'abandoned' || status === 'completed') {
    filter.status = status;
  }
  
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const leads = await CheckoutLead.find(filter)
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await CheckoutLead.countDocuments(filter);

  return {
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
      limitReached,
    },
    data: leads,
  };
};

const getLeadStats = async (tenantId: string) => {
  const now = new Date();
  
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const getStats = async (startDate?: Date) => {
    const query: any = { tenantId };
    if (startDate) {
      query.createdAt = { $gte: startDate };
    }

    const [abandoned, completed] = await Promise.all([
      CheckoutLead.countDocuments({ ...query, status: 'abandoned' }),
      CheckoutLead.countDocuments({ ...query, status: 'completed' })
    ]);

    return { abandoned, completed };
  };

  const [allTime, thisWeek, thisMonth, thisYear] = await Promise.all([
    getStats(),
    getStats(startOfWeek),
    getStats(startOfMonth),
    getStats(startOfYear)
  ]);

  return { allTime, thisWeek, thisMonth, thisYear };
};

const updateLeadStatus = async (
  tenantId: string,
  leadId: string,
  status: 'abandoned' | 'completed'
) => {
  if (!Types.ObjectId.isValid(leadId)) {
    throw new CustomError(400, 'Invalid checkout lead ID');
  }

  const updated = await CheckoutLead.findOneAndUpdate(
    { _id: leadId, tenantId },
    { $set: { status } },
    { returnDocument: 'after' }
  );

  if (!updated) {
    throw new CustomError(404, 'Checkout lead not found');
  }

  return updated;
};

export const CheckoutLeadService = {
  trackLead,
  getMerchantLeads,
  getLeadStats,
  updateLeadStatus,
};
