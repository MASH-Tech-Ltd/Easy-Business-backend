import { CheckoutLead } from './checkoutLead.model';
import { ICheckoutLead } from './checkoutLead.interface';
import { Subscription } from '../subscription/subscription.model';
import CustomError from '../../helpers/CustomError';
import { Types } from 'mongoose';

const trackLead = async (tenantId: string, payload: Partial<ICheckoutLead>) => {
  // Check addon active status and limit
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('purchasedAddons.addonId');
  if (!subscription || !subscription.purchasedAddons) return null; // Silently fail if no subscription

  const addonIndex = subscription.purchasedAddons.findIndex(
    (pa: any) => pa.addonId?.slug === 'abandoned_checkout' && pa.isActive
  );

  if (addonIndex === -1) return null; // Addon not active
  const addonInfo = subscription.purchasedAddons[addonIndex];
  if (!addonInfo) return null;

  // Try to find if an abandoned lead already exists for this phone or email in this tenant
  const query: any = { tenantId, status: 'abandoned' };
  
  if (payload.phone && payload.email) {
    query.$or = [{ phone: payload.phone }, { email: payload.email }];
  } else if (payload.phone) {
    query.phone = payload.phone;
  } else if (payload.email) {
    query.email = payload.email;
  } else {
    // If no phone or email, we just create a new one, checking limit first.
    if (addonInfo.used >= addonInfo.limit) return null; // Limit reached
    subscription.purchasedAddons[addonIndex]!.used += 1;
    await subscription.save();
    return await CheckoutLead.create({ ...payload, tenantId });
  }

  const existingLead = await CheckoutLead.findOne(query).sort({ createdAt: -1 });

  if (existingLead) {
    // Update existing lead with new info (does not consume a limit point)
    Object.assign(existingLead, payload);
    return await existingLead.save();
  } else {
    // Create new lead, must check limit
    if (addonInfo.used >= addonInfo.limit) return null; // Limit reached
    subscription.purchasedAddons[addonIndex]!.used += 1;
    await subscription.save();
    return await CheckoutLead.create({ ...payload, tenantId });
  }
};

const getMerchantLeads = async (tenantId: string, query: any) => {
  // Check if tenant has the 'abandoned_checkout' addon active
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('purchasedAddons.addonId');
  
  if (!subscription || !subscription.purchasedAddons) {
    throw new CustomError(403, 'Subscription not found or no addons purchased');
  }

  const addonInfo = subscription.purchasedAddons.find(
    (pa: any) => pa.addonId?.slug === 'abandoned_checkout' && pa.isActive
  );

  if (!addonInfo) {
    throw new CustomError(403, 'Abandoned Checkout add-on is not active or purchased for this subscription');
  }

  const limitReached = addonInfo.used >= addonInfo.limit;

  const { page = 1, limit = 10, search = '' } = query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = { tenantId, status: 'abandoned' };
  
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

export const CheckoutLeadService = {
  trackLead,
  getMerchantLeads,
  getLeadStats,
};
