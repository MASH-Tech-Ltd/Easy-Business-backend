import { ISubscription } from './subscription.interface';
import { Subscription } from './subscription.model';
import { Addon } from '../addon/addon.model';
import { Package } from '../package/package.model';
import { Tenant } from '../tenant/tenant.model';
import CustomError from '../../helpers/CustomError';
import { paginationHelper } from '../../helpers/paginationHelper';
import { notificationService } from '../notification/notification.service';
import { User } from '../auth/auth.model';
import { PlatformPaymentSubmission } from '../billing/billing.model';


const notifySubscriptionUpdate = async (tenantId?: string) => {
  try {
    const io = require('../../socket').getIO();
    const superAdmins = await User.find({ role: 'super_admin' });
    for (const admin of superAdmins) {
      io.to('user_' + admin._id.toString()).emit('refresh_subscriptions');
    }
    if (tenantId) {
      const tenant = await Tenant.findById(tenantId);
      if (tenant && tenant.ownerId) {
        io.to('user_' + tenant.ownerId.toString()).emit('refresh_subscriptions');
      }
    }
  } catch (error) {}
};

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

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
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

  const subscription = await Subscription.create({
    tenantId,
    packageId,
    startDate: new Date(),
    endDate: new Date(),
    status: 'pending',
  });

  const tenant = await Tenant.findById(tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'SUBSCRIPTION_PENDING',
      'Subscription Request Pending',
      `Your request for ${selectedPackage.name} has been received and is pending approval.`,
      subscription._id,
      tenantId
    );

    const superAdmins = await User.find({ role: 'super_admin' });
    for (const admin of superAdmins) {
      await notificationService.createNotification(
        admin._id,
        'SUBSCRIPTION_REQUESTED',
        'New Subscription Request',
        `Tenant ${tenant.name || tenant.domain || 'unknown'} has requested a subscription to ${selectedPackage.name}.`,
        subscription._id,
        tenantId
      );
    }
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
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

  const tenant = await Tenant.findById(subscription.tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'SUBSCRIPTION_APPROVED',
      'Subscription Approved',
      `Your subscription to ${selectedPackage.name} has been approved and is now active.`,
      subscription._id,
      subscription.tenantId
    );
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
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

  const tenant = await Tenant.findById(subscription.tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'SUBSCRIPTION_REJECTED',
      'Subscription Rejected',
      `Your recent subscription request has been rejected. Please contact support.`,
      subscription._id,
      subscription.tenantId
    );
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
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
  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
  return subscription;
};

const deleteSubscription = async (subscriptionId: string): Promise<void> => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) {
    throw new CustomError(404, 'Subscription not found');
  }
  await Subscription.deleteOne({ _id: subscriptionId });
  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
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
    if (existing.status === 'rejected' || existing.status === 'terminated' || existing.status === 'inactive') {
      existing.status = 'pending';
      existing.isActive = false;
      existing.used = 0;
      existing.limit = addon.defaultLimit;
      existing.requestedAt = new Date();
      
      await subscription.save();
      return subscription;
    } else if (existing.status === 'active' && existing.used >= existing.limit && existing.limit > 0) {
      existing.status = 'pending';
      existing.isActive = false; // Temporarily disable until approved
      existing.requestedAt = new Date();
      
      await subscription.save();
      return subscription;
    } else if (existing.status === 'pending') {
      throw new CustomError(400, 'Addon request is already pending approval');
    } else {
      throw new CustomError(400, 'Addon is already active');
    }
  }

  subscription.purchasedAddons.push({
    addonId: addon._id as any,
    limit: addon.defaultLimit,
    used: 0,
    isActive: false,
    status: 'pending',
    requestedAt: new Date(),
  });

  await subscription.save();

  const tenant = await Tenant.findById(tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'ADDON_REQUESTED',
      'Addon Requested',
      `Your request for ${addon.name} has been received and is pending approval.`,
      addon._id,
      tenantId
    );

    const superAdmins = await User.find({ role: 'super_admin' });
    for (const admin of superAdmins) {
      await notificationService.createNotification(
        admin._id,
        'ADDON_REQUESTED',
        'New Addon Request',
        `Tenant ${tenant.name || tenant.domain || 'unknown'} has requested the addon ${addon.name}.`,
        addon._id,
        tenantId
      );
    }
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
  return subscription;
};

const getAllAddonRequests = async (query: any): Promise<{ data: any[]; meta: any; stats: any }> => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, sortBy } = query || {};

  const subscriptions = await Subscription.find({
    'purchasedAddons': { $exists: true, $not: { $size: 0 } }
  })
    .populate('tenantId', 'name domain slug customDomain domainStatus')
    .populate('purchasedAddons.addonId', '-createdAt -updatedAt -__v')
    .lean();
    
  const payments = await PlatformPaymentSubmission.find({ purpose: 'addon' }).sort({ createdAt: -1 }).lean();
    
  let allAddons: any[] = [];
  
  subscriptions.forEach(sub => {
    sub.purchasedAddons?.forEach((addon: any) => {
      let requestedAt = addon.requestedAt;
      if (!requestedAt && addon._id) {
        const idStr = addon._id.toString();
        if (idStr.length === 24) {
          const ts = parseInt(idStr.substring(0, 8), 16) * 1000;
          if (!isNaN(ts) && ts > 0) {
            requestedAt = new Date(ts);
          }
        }
      }
      if (!requestedAt) {
        requestedAt = sub.updatedAt || sub.createdAt || new Date();
      }

      let addonDetails = addon.addonId;
      if (addonDetails && typeof addonDetails === 'object') {
        const { createdAt, updatedAt, __v, ...cleanDetails } = addonDetails;
        addonDetails = cleanDetails;
      }

      const tenantObj: any = sub.tenantId;
      const tenantIdStr = tenantObj?._id?.toString() || tenantObj?.toString() || '';
      const addonName = addonDetails?.name || '';
      const matchingPayment = payments.find(p => 
        p.tenantId?.toString() === tenantIdStr &&
        addonName &&
        (p.purposeTitle?.trim().toLowerCase().includes(addonName.trim().toLowerCase()) ||
         addonName.trim().toLowerCase().includes(p.purposeTitle?.trim().toLowerCase()))
      );

      allAddons.push({
        subscriptionId: sub._id,
        tenant: sub.tenantId,
        addonId: addon._id,
        addonDetails,
        limit: addon.limit || 0,
        used: addon.used || 0,
        status: addon.status || (addon.isActive ? 'active' : 'pending'),
        requestedAt,
        paymentStatus: matchingPayment?.status || 'none',
        paymentInfo: matchingPayment ? {
          _id: matchingPayment._id,
          transactionId: matchingPayment.transactionId,
          provider: matchingPayment.provider,
          senderNumber: matchingPayment.senderNumber,
          amount: matchingPayment.amount,
          status: matchingPayment.status,
          createdAt: matchingPayment.createdAt
        } : null,
      });
    });
  });

  const stats = {
    totalActive: allAddons.filter(a => a.status === 'active').length,
    totalPending: allAddons.filter(a => a.status === 'pending').length,
    totalInactive: allAddons.filter(a => a.status === 'inactive').length,
    totalTerminated: allAddons.filter(a => a.status === 'terminated').length,
    totalRejected: allAddons.filter(a => a.status === 'rejected').length,
    totalRevenue: allAddons
      .filter(a => a.status !== 'pending' && a.status !== 'rejected')
      .reduce((sum, a) => sum + (a.addonDetails?.price || 0), 0)
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

  const getTimestamp = (val: any): number => {
    if (!val) return 0;
    const time = new Date(val).getTime();
    return isNaN(time) ? 0 : time;
  };

  allAddons.sort((a, b) => {
    const timeA = getTimestamp(a.requestedAt);
    const timeB = getTimestamp(b.requestedAt);
    if (sortBy === 'oldest') {
      return timeA - timeB;
    }
    return timeB - timeA; // Default: newest first
  });

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

  // Ensure add-on approval is NOT possible without an approved/confirmed payment
  const latestPayment = await PlatformPaymentSubmission.findOne({
    tenantId: subscription.tenantId,
    purpose: 'addon',
    $or: [
      { purposeTitle: { $regex: new RegExp(`^${addonDoc.name.trim()}$`, 'i') } },
      { purposeTitle: { $regex: new RegExp(addonDoc.name.trim(), 'i') } },
    ]
  }).sort({ createdAt: -1 });

  if (!latestPayment || latestPayment.status !== 'approved') {
    if (!latestPayment) {
      throw new CustomError(
        400,
        'Cannot approve add-on request without payment confirmation. No payment proof has been submitted yet for this add-on.'
      );
    }
    if (latestPayment.status === 'pending') {
      throw new CustomError(
        400,
        'Cannot approve add-on request while payment verification is pending. Please verify and approve the payment proof under Payment Proof Verifications (TrxID) first.'
      );
    }
    if (latestPayment.status === 'rejected') {
      throw new CustomError(
        400,
        'Cannot approve add-on request because its payment proof was rejected. The merchant must submit a valid payment proof first.'
      );
    }
  }

  // If the addon was repurchased (limit exceeded), add the new limit
  if (addon.used >= addon.limit && addon.limit > 0) {
    addon.limit += addonDoc.defaultLimit;
  }

  addon.status = 'active';
  addon.isActive = true;

  await subscription.save();

  const tenant = await Tenant.findById(subscription.tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'ADDON_APPROVED',
      'Addon Approved',
      `Your request for ${addonDoc.name} has been approved.`,
      addon._id,
      subscription.tenantId
    );
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
  return subscription;
};

const deactivateAddonRequest = async (subscriptionId: string, addonId: string) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw new CustomError(404, 'Subscription not found');

  const addonIndex = subscription.purchasedAddons?.findIndex(a => a._id?.toString() === addonId);
  if (addonIndex === undefined || addonIndex === -1) throw new CustomError(404, 'Addon request not found');

  const addon = subscription.purchasedAddons![addonIndex];
  if (!addon) throw new CustomError(404, 'Addon not found');

  const addonDoc = await Addon.findById(addon.addonId);

  addon.status = 'inactive';
  addon.isActive = false;

  await subscription.save();

  const tenant = await Tenant.findById(subscription.tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'ADDON_DEACTIVATED',
      'Addon Temporarily On Hold',
      `Your addon ${addonDoc?.name || ''} is temporarily on hold. Please contact support or re-activate in your dashboard.`,
      addon._id,
      subscription.tenantId
    );
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
  return subscription;
};

const reactivateAddonRequest = async (subscriptionId: string, addonId: string) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw new CustomError(404, 'Subscription not found');

  const addonIndex = subscription.purchasedAddons?.findIndex(a => a._id?.toString() === addonId);
  if (addonIndex === undefined || addonIndex === -1) throw new CustomError(404, 'Addon request not found');

  const addon = subscription.purchasedAddons![addonIndex];
  if (!addon) throw new CustomError(404, 'Addon not found');

  const addonDoc = await Addon.findById(addon.addonId);

  if (addonDoc) {
    const latestPayment = await PlatformPaymentSubmission.findOne({
      tenantId: subscription.tenantId,
      purpose: 'addon',
      $or: [
        { purposeTitle: { $regex: new RegExp(`^${addonDoc.name.trim()}$`, 'i') } },
        { purposeTitle: { $regex: new RegExp(addonDoc.name.trim(), 'i') } },
      ]
    }).sort({ createdAt: -1 });

    if (!latestPayment || latestPayment.status !== 'approved') {
      throw new CustomError(
        400,
        'Cannot reactivate add-on without payment confirmation. No approved payment proof found for this add-on.'
      );
    }
  }

  addon.status = 'active';
  addon.isActive = true;

  await subscription.save();

  const tenant = await Tenant.findById(subscription.tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'ADDON_REACTIVATED',
      'Addon Reactivated',
      `Your addon ${addonDoc?.name || ''} has been reactivated.`,
      addon._id,
      subscription.tenantId
    );
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
  return subscription;
};

const extendAddonLimit = async (subscriptionId: string, addonId: string, extraLimit?: number) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw new CustomError(404, 'Subscription not found');

  const addonIndex = subscription.purchasedAddons?.findIndex(a => a._id?.toString() === addonId);
  if (addonIndex === undefined || addonIndex === -1) throw new CustomError(404, 'Addon request not found');

  const addon = subscription.purchasedAddons![addonIndex];
  if (!addon) throw new CustomError(404, 'Addon not found');

  const addonDoc = await Addon.findById(addon.addonId);
  const increment = Number(extraLimit) || addonDoc?.defaultLimit || 50;

  addon.limit += increment;
  addon.status = 'active';
  addon.isActive = true;

  await subscription.save();

  const tenant = await Tenant.findById(subscription.tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'ADDON_LIMIT_EXTENDED',
      'Addon Limit Extended',
      `Your limit for ${addonDoc?.name || 'addon'} has been extended by ${increment} units.`,
      addon._id,
      subscription.tenantId
    );
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
  return subscription;
};

const terminateAddonRequest = async (subscriptionId: string, addonId: string) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw new CustomError(404, 'Subscription not found');

  const addonIndex = subscription.purchasedAddons?.findIndex(a => a._id?.toString() === addonId);
  if (addonIndex === undefined || addonIndex === -1) throw new CustomError(404, 'Addon request not found');

  const addon = subscription.purchasedAddons![addonIndex];
  if (!addon) throw new CustomError(404, 'Addon not found');

  const addonDoc = await Addon.findById(addon.addonId);

  addon.status = 'terminated';
  addon.isActive = false;

  await subscription.save();

  const tenant = await Tenant.findById(subscription.tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'ADDON_TERMINATED',
      'Addon Terminated',
      `Your addon ${addonDoc?.name || ''} has been terminated by Super Admin.`,
      addon._id,
      subscription.tenantId
    );
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
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

  // Automatically mark any pending payment submission for this addon as rejected
  if (addon.addonId) {
    const addonDoc = await Addon.findById(addon.addonId);
    if (addonDoc) {
      await PlatformPaymentSubmission.updateMany(
        {
          tenantId: subscription.tenantId,
          purpose: 'addon',
          purposeTitle: { $regex: new RegExp(`^${addonDoc.name.trim()}$`, 'i') },
          status: 'pending',
        },
        { status: 'rejected' }
      );
    }
  }

  const tenant = await Tenant.findById(subscription.tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      'ADDON_REJECTED',
      'Addon Rejected',
      `Your request for an addon has been rejected.`,
      addon._id,
      subscription.tenantId
    );
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
  return subscription;
};

const removeAddon = async (subscriptionId: string, addonId: string) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw new CustomError(404, 'Subscription not found');

  const addonIndex = subscription.purchasedAddons?.findIndex(a => a._id?.toString() === addonId);
  if (addonIndex === undefined || addonIndex === -1) throw new CustomError(404, 'Addon request not found');

  const removedAddon = subscription.purchasedAddons![addonIndex];
  subscription.purchasedAddons?.splice(addonIndex, 1);

  await subscription.save();

  // If the removed addon has an addonId, clean up any associated payment submissions
  if (removedAddon?.addonId) {
    try {
      const addonDoc = await Addon.findById(removedAddon.addonId);
      if (addonDoc) {
        await PlatformPaymentSubmission.deleteMany({
          tenantId: subscription.tenantId,
          purpose: 'addon',
          purposeTitle: { $regex: new RegExp(`^${addonDoc.name.trim()}$`, 'i') },
        });
      }
    } catch (e) {
      // Ignore cleanup error if already removed
    }
  }

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
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
  deactivateAddonRequest,
  reactivateAddonRequest,
  extendAddonLimit,
  terminateAddonRequest,
  rejectAddonRequest,
  removeAddon,
};
