import { ISubscription } from './subscription.interface';
import { Subscription } from './subscription.model';
import { Addon } from '../addon/addon.model';
import { Package } from '../package/package.model';
import { Tenant } from '../tenant/tenant.model';
import CustomError from '../../helpers/CustomError';
import { paginationHelper } from '../../helpers/paginationHelper';

const assignPackage = async (payload: { tenantId: string, packageId: string }): Promise<ISubscription> => {
  const selectedPackage = await Package.findById(payload.packageId);
  if (!selectedPackage) {
    throw new CustomError(404, 'Package not found');
  }

  // Find the most recent subscription (any status) to calculate the baseline.
  // If renewing before expiry: startDate = previous endDate (seamless extension, no gap).
  // If renewing after expiry:  startDate = previous endDate (credit from when the last period ended).
  // If no prior subscription at all: startDate = now.
  const lastSub = await Subscription.findOne(
    { tenantId: payload.tenantId, status: { $in: ['active', 'expired', 'cancelled'] } },
    null,
    { sort: { endDate: -1 } }
  );

  let startDate = (lastSub && lastSub.endDate) ? new Date(lastSub.endDate) : new Date();

  // If the last subscription was a free trial, start the new paid one immediately
  if (lastSub && lastSub.isTrial) {
    startDate = new Date();
    if (lastSub.status === 'active') {
      lastSub.status = 'expired';
      await lastSub.save();
    }
  }

  const endDate = new Date(startDate);

  if (selectedPackage.billingCycle === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  // We preserve the existing active subscriptions so they can run their course.

  // Extract inherited addons from last sub to carry them over
  const inheritedAddons = lastSub?.purchasedAddons?.map(addon => ({
    addonId: addon.addonId,
    limit: addon.limit,
    used: addon.used,
    isActive: addon.isActive,
    ...(addon.status !== undefined ? { status: addon.status } : {}),
  })) || [];

  const subscription = await Subscription.create({
    tenantId: payload.tenantId,
    packageId: payload.packageId,
    startDate,
    endDate,
    status: 'active',
    purchasedAddons: inheritedAddons,
  });

  return subscription;
};

const getTenantSubscription = async (tenantId: string): Promise<ISubscription | null> => {
  const now = new Date();

  // Find all active or pending subscriptions, sorted by start date
  const subs = await Subscription.find({ tenantId, status: { $in: ['active', 'pending'] } })
    .populate('packageId')
    .sort({ startDate: 1 });

  let validSub = null;

  for (const sub of subs) {
    const start = new Date(sub.startDate).getTime();
    const end = new Date(sub.endDate).getTime();
    const nowTime = now.getTime();

    if (end < nowTime) {
      if (sub.status === 'active') {
        // Lazy expire active subscriptions that have passed their end date
        sub.status = 'expired';
        await sub.save();
      }
    } else if (start <= nowTime && end >= nowTime) {
      // If it's valid now but pending, activate it
      if (sub.status === 'pending') {
        sub.status = 'active';
        await sub.save();
      }
      // If we haven't found a valid sub yet, use this one
      if (!validSub) {
        validSub = sub;
      }
    } else if (start > nowTime && sub.status === 'active') {
      // If it's in the future and marked active, we might want to change it to pending? 
      // Actually we can just leave it active, but we won't select it as the *current* valid sub.
    }
  }

  if (validSub) {
    return validSub;
  }

  // If no currently valid subscription exists, return the closest future one (if any)
  // This allows the UI to show upcoming renewals even if there's a temporary gap
  const futureSub = await Subscription.findOne(
    { tenantId, status: { $in: ['active', 'pending'] }, startDate: { $gt: now } },
    null,
    { sort: { startDate: 1 } }
  ).populate('packageId');

  return futureSub;
};

const requestPackage = async (tenantId: string, packageId: string): Promise<ISubscription> => {
  const selectedPackage = await Package.findById(packageId);
  if (!selectedPackage) {
    throw new CustomError(404, 'Package not found');
  }

  const existingPending = await Subscription.findOne({ tenantId, status: 'pending' });
  if (existingPending) {
    throw new CustomError(400, 'You already have a pending subscription request');
  }

  // Create a pending subscription
  const subscription = await Subscription.create({
    tenantId,
    packageId,
    startDate: new Date(),
    endDate: new Date(),
    status: 'pending',
  });

  return subscription;
};

const approveSubscription = async (subscriptionId: string): Promise<ISubscription> => {
  const subscription = await Subscription.findById(subscriptionId).populate('packageId');
  if (!subscription) {
    throw new CustomError(404, 'Subscription request not found');
  }
  if (subscription.status !== 'pending') {
    throw new CustomError(400, 'Only pending subscriptions can be approved');
  }

  const selectedPackage = subscription.packageId as any;

  // Find the most recent non-pending subscription (active or expired) to determine
  // the correct start date. New period always begins from where the last one ended.
  const lastSub = await Subscription.findOne(
    { tenantId: subscription.tenantId, status: { $in: ['active', 'expired', 'cancelled'] } },
    null,
    { sort: { endDate: -1 } }
  );

  let startDate = (lastSub && lastSub.endDate) ? new Date(lastSub.endDate) : new Date();

  // If the last subscription was a free trial, start the new paid one immediately
  if (lastSub && lastSub.isTrial) {
    startDate = new Date();
    if (lastSub.status === 'active') {
      lastSub.status = 'expired';
      await lastSub.save();
    }
  }

  const endDate = new Date(startDate);

  if (selectedPackage.billingCycle === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  // We preserve the existing active subscriptions so they can run their course.

  subscription.startDate = startDate;
  subscription.endDate = endDate;
  subscription.status = 'active';
  await subscription.save();

  return subscription;
};

const rejectSubscription = async (subscriptionId: string): Promise<ISubscription> => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) {
    throw new CustomError(404, 'Subscription request not found');
  }
  if (subscription.status !== 'pending') {
    throw new CustomError(400, 'Only pending subscriptions can be rejected');
  }

  subscription.status = 'cancelled';
  await subscription.save();

  return subscription;
};

const getAllSubscriptions = async (query: any): Promise<{ data: any[]; meta: any }> => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, sortBy } = query;

  let filter: any = {};
  if (status && status !== 'all') {
    filter.status = status;
  }

  if (search) {
    const tenants = await Tenant.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { domain: { $regex: search, $options: 'i' } }
      ]
    }).select('_id');
    const tenantIds = tenants.map(t => t._id);
    filter.tenantId = { $in: tenantIds };
  }

  let sortCriteria: any = { status: -1, createdAt: -1 };
  if (sortBy === 'newest') sortCriteria = { createdAt: -1 };
  else if (sortBy === 'oldest') sortCriteria = { createdAt: 1 };

  const [data, total] = await Promise.all([
    Subscription.find(filter)
      .populate({
        path: 'tenantId',
        populate: { path: 'ownerId', select: 'email name' }
      })
      .populate('packageId')
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean(),
    Subscription.countDocuments(filter)
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  };
};

const updateSubscription = async (subscriptionId: string, payload: Partial<ISubscription>): Promise<ISubscription> => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) {
    throw new CustomError(404, 'Subscription not found');
  }

  if (payload.startDate) subscription.startDate = new Date(payload.startDate);
  if (payload.endDate) subscription.endDate = new Date(payload.endDate);
  if (payload.status) subscription.status = payload.status;
  
  await subscription.save();
  return subscription;
};

const deleteSubscription = async (subscriptionId: string): Promise<void> => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) {
    throw new CustomError(404, 'Subscription not found');
  }
  await Subscription.deleteOne({ _id: subscriptionId });
};

const purchaseAddon = async (tenantId: string, payload: { addonId: string }): Promise<ISubscription> => {
  const subscription = await Subscription.findOne({ tenantId, status: 'active' });
  if (!subscription) {
    throw new CustomError(404, 'Active subscription not found for this tenant');
  }

  if (subscription.isTrial) {
    throw new CustomError(400, 'Addons cannot be purchased during a free trial. Please upgrade to a paid plan first.');
  }

  const addon = await Addon.findById(payload.addonId);
  if (!addon || !addon.isActive) {
    throw new CustomError(404, 'Addon not found or is inactive');
  }

  subscription.purchasedAddons = subscription.purchasedAddons || [];
  
  const existing = subscription.purchasedAddons.find(pa => pa.addonId.toString() === payload.addonId);
  if (existing) {
    if (existing.status === 'rejected') {
      existing.status = 'pending';
      existing.isActive = false;
      existing.used = 0;
      existing.limit = addon.defaultLimit;
      
      await subscription.save();
      return subscription;
    } else if (existing.status === 'active' && existing.used >= existing.limit && existing.limit > 0) {
      existing.status = 'pending';
      existing.isActive = false; // Temporarily disable until approved
      
      await subscription.save();
      return subscription;
    } else {
      throw new CustomError(400, 'Addon already purchased');
    }
  }

  subscription.purchasedAddons.push({
    addonId: addon._id as any,
    limit: addon.defaultLimit,
    used: 0,
    isActive: false,
    status: 'pending',
  });

  await subscription.save();
  return subscription;
};

const getAllAddonRequests = async (query: any): Promise<{ data: any[]; meta: any; stats: any }> => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, sortBy } = query || {};

  const subscriptions = await Subscription.find({
    'purchasedAddons': { $exists: true, $not: { $size: 0 } }
  })
    .populate('tenantId', 'name domain slug')
    .populate('purchasedAddons.addonId')
    .lean();
    
  let allAddons: any[] = [];
  
  subscriptions.forEach(sub => {
    sub.purchasedAddons?.forEach((addon: any) => {
      allAddons.push({
        subscriptionId: sub._id,
        tenant: sub.tenantId,
        addonId: addon._id,
        addonDetails: addon.addonId,
        status: addon.status || (addon.isActive ? 'active' : 'pending'),
        requestedAt: sub.updatedAt,
      });
    });
  });

  const stats = {
    totalActive: allAddons.filter(a => a.status === 'active').length,
    totalPending: allAddons.filter(a => a.status === 'pending').length,
    totalRejected: allAddons.filter(a => a.status === 'rejected').length,
    totalRevenue: allAddons.filter(a => a.status === 'active').reduce((sum, a) => sum + (a.addonDetails?.price || 0), 0)
  };

  if (status && status !== 'all') {
    allAddons = allAddons.filter(a => a.status === status);
  }

  if (search) {
    const searchLower = search.toLowerCase();
    allAddons = allAddons.filter(a => 
      a.tenant?.name?.toLowerCase().includes(searchLower) ||
      a.tenant?.domain?.toLowerCase().includes(searchLower)
    );
  }

  if (sortBy === 'oldest') {
    allAddons.sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());
  } else {
    allAddons.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }

  const total = allAddons.length;
  const paginatedData = allAddons.slice(skip, skip + limit);

  return {
    data: paginatedData,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    stats
  };
};

const approveAddonRequest = async (subscriptionId: string, addonId: string) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw new CustomError(404, 'Subscription not found');

  const addonIndex = subscription.purchasedAddons?.findIndex(a => a._id?.toString() === addonId);
  if (addonIndex === undefined || addonIndex === -1) throw new CustomError(404, 'Addon request not found');

  const addon = subscription.purchasedAddons![addonIndex];
  if (!addon) throw new CustomError(404, 'Addon not found');

  const addonDoc = await Addon.findById(addon.addonId);
  if (!addonDoc) throw new CustomError(404, 'Addon details not found');

  // If the addon was repurchased (limit exceeded), add the new limit
  if (addon.used >= addon.limit && addon.limit > 0) {
    addon.limit += addonDoc.defaultLimit;
  }

  addon.status = 'active';
  addon.isActive = true;

  await subscription.save();
  return subscription;
};

const rejectAddonRequest = async (subscriptionId: string, addonId: string) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw new CustomError(404, 'Subscription not found');

  const addonIndex = subscription.purchasedAddons?.findIndex(a => a._id?.toString() === addonId);
  if (addonIndex === undefined || addonIndex === -1) throw new CustomError(404, 'Addon request not found');

  const addon = subscription.purchasedAddons![addonIndex];
  if (!addon) throw new CustomError(404, 'Addon not found');

  addon.status = 'rejected';
  addon.isActive = false;

  await subscription.save();
  return subscription;
};

const removeAddon = async (subscriptionId: string, addonId: string) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw new CustomError(404, 'Subscription not found');

  const addonIndex = subscription.purchasedAddons?.findIndex(a => a._id?.toString() === addonId);
  if (addonIndex === undefined || addonIndex === -1) throw new CustomError(404, 'Addon request not found');

  subscription.purchasedAddons?.splice(addonIndex, 1);

  await subscription.save();
  return subscription;
};

export const SubscriptionService = {
  assignPackage,
  getTenantSubscription,
  requestPackage,
  approveSubscription,
  rejectSubscription,
  getAllSubscriptions,
  updateSubscription,
  deleteSubscription,
  purchaseAddon,
  getAllAddonRequests,
  approveAddonRequest,
  rejectAddonRequest,
  removeAddon,
};
