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
import { ReferralService } from '../referral/referral.service';


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

  // Find the currently active subscription that ends in the future
  const lastActiveSub = await Subscription.findOne(
    { tenantId: payload.tenantId, status: 'active', endDate: { $gt: new Date() } },
    null,
    { sort: { endDate: -1 } }
  );

  let startDate = new Date();
  if (lastActiveSub && !lastActiveSub.isTrial && lastActiveSub.endDate) {
    // Seamless extension: start exactly at current active sub's endDate (0 gap)
    startDate = new Date(lastActiveSub.endDate);
  } else {
    // If no active sub, or last was free trial, or last was cancelled/expired:
    startDate = new Date();
    if (lastActiveSub && lastActiveSub.isTrial) {
      lastActiveSub.status = 'expired';
      await lastActiveSub.save();
    }
  }

  const endDate = new Date(startDate);

  if (selectedPackage.billingCycle === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  // We preserve the existing active subscriptions so they can run their course.

  // Extract inherited addons from last active sub to carry them over
  const inheritedAddons = (lastActiveSub as any)?.purchasedAddons?.map((addon: any) => ({
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

  // When assigning a paid package directly, mark any first-time referral discount as used
  await Tenant.findByIdAndUpdate(payload.tenantId, {
    $set: { 'referralDiscount.used': true },
  });

  await notifySubscriptionUpdate((subscription as any)?.tenantId?.toString());
  return subscription;
};

const getTenantSubscription = async (tenantId: string): Promise<ISubscription | null> => {
  const now = new Date();

  // Find all active or pending subscriptions, sorted by start date
  const subs = await Subscription.find({ tenantId, status: { $in: ['active', 'pending'] } })
    .populate('packageId')
    .populate('purchasedAddons.addonId')
    .sort({ startDate: 1 });

  let validSub: any = null;
  let futureSub: any = null;
  let maxFutureEndDate: any = null;

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
    } else if (start > nowTime && (sub.status === 'active' || sub.status === 'pending')) {
      if (!futureSub) {
        futureSub = sub;
      }
      if (!maxFutureEndDate || end > new Date(maxFutureEndDate).getTime()) {
        maxFutureEndDate = sub.endDate;
      }
    }
  }

  const targetSub = validSub || futureSub || (await Subscription.findOne(
    { tenantId, status: { $in: ['active', 'pending'] } },
    null,
    { sort: { endDate: -1 } }
  ).populate('packageId').populate('purchasedAddons.addonId'));

  if (!targetSub) {
    return null;
  }

  const sanitizeSub = (sub: any) => {
    if (!sub) return sub;
    const pkgPrice = (sub.packageId as any)?.price || 0;
    if (sub.discountApplied) {
      const val = Number(sub.discountApplied.discountValue || 0);
      const amt = Number(sub.discountApplied.discountAmount || 0);
      if (val <= 0 && amt <= 0) {
        sub.discountApplied = null;
      }
    }
    if ((sub.paidAmount === null || sub.paidAmount === undefined || (sub.paidAmount === 0 && pkgPrice > 0 && !sub.isTrial && !sub.discountApplied)) && pkgPrice > 0) {
      sub.paidAmount = sub.originalPrice || pkgPrice;
    }
    if (sub.originalPrice === null || sub.originalPrice === undefined) {
      sub.originalPrice = pkgPrice;
    }
    return sub;
  };

  // Ensure targetSub has paidAmount and originalPrice
  if (targetSub.paidAmount === undefined || targetSub.paidAmount === null) {
    const pkgPrice = (targetSub.packageId as any)?.price || 0;
    targetSub.paidAmount = pkgPrice;
    targetSub.originalPrice = pkgPrice;
    try {
      await targetSub.save();
    } catch (_) {}
  }

  const cleanTarget: any = sanitizeSub(targetSub.toObject ? targetSub.toObject() : targetSub);

  // If there is an upcoming renewal / future subscription queued
  const queuedSub = (validSub && futureSub && futureSub._id.toString() !== validSub._id.toString())
    ? sanitizeSub(futureSub.toObject ? futureSub.toObject() : futureSub)
    : null;

  // If there is NO currently running subscription (validSub is null), but a future subscription is scheduled:
  if (!validSub && futureSub) {
    cleanTarget.isUpcomingOnly = true;
    cleanTarget.status = 'upcoming';
    cleanTarget.daysUntilStart = Math.max(1, Math.ceil((new Date(futureSub.startDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    cleanTarget.upcomingStartDate = futureSub.startDate;
    cleanTarget.upcomingEndDate = futureSub.endDate;
    cleanTarget.isRenewed = false;
  } else if (queuedSub) {
    cleanTarget.isUpcomingOnly = false;
    cleanTarget.isRenewed = true;
    cleanTarget.renewalEndDate = queuedSub.endDate;
    cleanTarget.extendedEndDate = maxFutureEndDate || queuedSub.endDate;
    cleanTarget.renewalStatus = queuedSub.status;
    cleanTarget.queuedSubscription = queuedSub;
  } else {
    cleanTarget.isUpcomingOnly = false;
    cleanTarget.isRenewed = false;
    cleanTarget.extendedEndDate = cleanTarget.endDate;
  }

  // Check if there is any pending subscription request for this tenant
  const pendingSub = await Subscription.findOne({ tenantId, status: 'pending' }).populate('packageId');
  if (pendingSub && (!validSub || pendingSub._id.toString() !== validSub._id.toString())) {
    cleanTarget.hasPendingRequest = true;
    cleanTarget.pendingSubscription = sanitizeSub(pendingSub.toObject ? pendingSub.toObject() : pendingSub);
  } else {
    cleanTarget.hasPendingRequest = false;
  }

  return cleanTarget;
};

const requestPackage = async (
  tenantId: string,
  packageId: string,
  activationType: 'immediate' | 'queue' = 'immediate'
): Promise<ISubscription> => {
  const selectedPackage = await Package.findById(packageId);
  if (!selectedPackage) {
    throw new CustomError(404, 'Package not found');
  }

  const existingPending = await Subscription.findOne({ tenantId, status: 'pending' });
  if (existingPending) {
    throw new CustomError(400, 'You already have a pending subscription request');
  }

  const tenant = await Tenant.findById(tenantId);
  let paidAmount = selectedPackage.price;
  let originalPrice = selectedPackage.price;
  let discountApplied: any = undefined;

  // Check if tenant has already had an active, expired, or past paid subscription
  const priorPaidSub = await Subscription.findOne({
    tenantId,
    status: { $in: ['active', 'expired', 'cancelled'] },
    isTrial: { $ne: true },
  });
  const hasPriorPaidSub = Boolean(priorPaidSub);

  // Referral discount only applies for the very first subscription when never used before
  if (!hasPriorPaidSub && tenant?.referralDiscount && !tenant.referralDiscount.used && tenant.referralDiscount.discountValue) {
    const rd = tenant.referralDiscount;
    const discountAmount =
      rd.discountType === 'percentage'
        ? Math.round((selectedPackage.price * rd.discountValue) / 100)
        : rd.discountValue;
    paidAmount = Math.max(0, selectedPackage.price - discountAmount);
    discountApplied = {
      discountType: rd.discountType,
      discountValue: rd.discountValue,
      discountAmount,
      reason: 'Referral Discount',
    };
  }

  const subscription = await Subscription.create({
    tenantId,
    packageId,
    startDate: new Date(),
    endDate: new Date(),
    status: 'pending',
    activationType: activationType === 'queue' ? 'queue' : 'immediate',
    originalPrice,
    paidAmount,
    discountApplied,
  });

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

  // Find currently active subscription to queue after
  const lastActiveSub = await Subscription.findOne(
    { 
      tenantId: subscription.tenantId, 
      status: 'active',
      endDate: { $gt: new Date() },
      _id: { $ne: subscription._id }
    },
    null,
    { sort: { endDate: -1 } }
  );

  // Check if this approval is for the SAME package or a DIFFERENT package
  const lastPackageIdStr = (lastActiveSub?.packageId as any)?._id?.toString() || lastActiveSub?.packageId?.toString() || '';
  const selectedPackageIdStr = (selectedPackage as any)?._id?.toString() || selectedPackage?.toString() || '';
  const isSamePackage = Boolean(lastPackageIdStr && selectedPackageIdStr && lastPackageIdStr === selectedPackageIdStr);

  let startDate = new Date();
  // Same package renewals always queue up to extend the remaining period.
  // Different package upgrades honor the merchant's choice (instant vs queue).
  const isQueue = isSamePackage || subscription.activationType === 'queue';

  if (isQueue && lastActiveSub && lastActiveSub.endDate && !lastActiveSub.isTrial) {
    // Option: Queue after the current active subscription ends (0 ms gap)
    startDate = new Date(lastActiveSub.endDate);
  } else {
    // Option: Immediate upgrade from today (different package or no current active)
    startDate = new Date();
    // If there is an active previous subscription, expire it so new upgraded features take effect right away
    if (lastActiveSub && lastActiveSub.status === 'active') {
      lastActiveSub.status = 'expired';
      await lastActiveSub.save();
    }
  }

  const endDate = new Date(startDate);

  if (selectedPackage.billingCycle === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

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

  // Unlock referral points for the referrer now that the merchant has purchased a paid subscription
  if (subscription.tenantId) {
    try {
      await ReferralService.unlockReferralPointsForSubscription(subscription.tenantId.toString());
      // Mark first-time referral discount as used so it cannot be claimed again
      await Tenant.findByIdAndUpdate(subscription.tenantId, {
        $set: { 'referralDiscount.used': true },
      });
    } catch (err) {
      console.error('Failed to unlock referral points:', err);
    }

    // Also sync and approve any related pending payment proof for this tenant
    try {
      const pendingPayment = await PlatformPaymentSubmission.findOne({
        tenantId: subscription.tenantId,
        purpose: { $in: ['package', 'renewal'] },
        status: 'pending',
      }).sort({ createdAt: -1 });

      if (pendingPayment) {
        pendingPayment.status = 'approved';
        pendingPayment.adminFeedback = 'Approved along with subscription activation';
        await pendingPayment.save();

        subscription.paidAmount = pendingPayment.amount;
        subscription.originalPrice = selectedPackage.price;
        if (pendingPayment.amount < selectedPackage.price) {
          const diff = selectedPackage.price - pendingPayment.amount;
          subscription.discountApplied = {
            discountType: 'percentage',
            discountValue: Math.round((diff / selectedPackage.price) * 100),
            discountAmount: diff,
            reason: 'Referral Discount',
          };
        }
        await subscription.save();
      }
    } catch (err) {
      console.error('Failed to sync payment submission on subscription approval:', err);
    }
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

  // Also sync and reject any related pending payment proof for this tenant
  if (subscription.tenantId) {
    try {
      const pendingPayment = await PlatformPaymentSubmission.findOne({
        tenantId: subscription.tenantId,
        purpose: { $in: ['package', 'renewal'] },
        status: 'pending',
      }).sort({ createdAt: -1 });

      if (pendingPayment) {
        pendingPayment.status = 'rejected';
        pendingPayment.adminFeedback = 'Rejected along with subscription rejection';
        await pendingPayment.save();
      }
    } catch (err) {
      console.error('Failed to sync payment submission on subscription rejection:', err);
    }
  }

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
  const { search, status, sortBy, year, month, startDate, endDate } = query;

  let filter: any = {};
  if (status && status !== 'all') {
    filter.status = status;
  }

  let dateStart: Date | null = null;
  let dateEnd: Date | null = null;

  if (startDate && endDate) {
    dateStart = new Date(startDate);
    dateStart.setHours(0, 0, 0, 0);
    dateEnd = new Date(endDate);
    dateEnd.setHours(23, 59, 59, 999);
  } else if (year && year !== 'all') {
    const numYear = parseInt(year);
    if (month && month !== 'all') {
      const numMonth = parseInt(month);
      dateStart = new Date(numYear, numMonth - 1, 1, 0, 0, 0, 0);
      dateEnd = new Date(numYear, numMonth, 0, 23, 59, 59, 999);
    } else {
      dateStart = new Date(numYear, 0, 1, 0, 0, 0, 0);
      dateEnd = new Date(numYear, 11, 31, 23, 59, 59, 999);
    }
  }

  if (dateStart && dateEnd) {
    filter.$or = [
      { startDate: { $gte: dateStart, $lte: dateEnd } },
      { createdAt: { $gte: dateStart, $lte: dateEnd } },
    ];
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

  const now = new Date();
  const tenantIdsInPage = data
    .map((s: any) => s.tenantId?._id || s.tenantId)
    .filter(Boolean);

  const activeRunningSubs = await Subscription.find({
    tenantId: { $in: tenantIdsInPage },
    status: 'active',
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .select('tenantId _id')
    .lean();

  const activeTenantIdSet = new Set(
    activeRunningSubs.map((s: any) => s.tenantId.toString())
  );

  const enrichedData = data.map((sub: any) => {
    const tId = sub.tenantId?._id?.toString() || sub.tenantId?.toString();
    const hasRunningActivePlan = Boolean(tId && activeTenantIdSet.has(tId));
    const isQueued = sub.status === 'active' && sub.startDate && new Date(sub.startDate) > now;
    const canActivateEarly = Boolean(isQueued && !hasRunningActivePlan);

    if (sub.isTrial) {
      return {
        ...sub,
        hasRunningActivePlan,
        canActivateEarly,
      };
    }

    const pkgPrice = sub.packageId?.price || 0;
    const originalPrice = sub.originalPrice ?? pkgPrice;
    let paidAmount = sub.paidAmount ?? originalPrice;
    let discountApplied = sub.discountApplied;

    if (discountApplied) {
      const val = Number(discountApplied.discountValue || 0);
      const amt = Number(discountApplied.discountAmount || 0);
      if (val <= 0 && amt <= 0) {
        discountApplied = null;
      }
    }

    // A discount is only valid if paidAmount is strictly less than originalPrice
    if (!discountApplied || Number(paidAmount) >= Number(originalPrice)) {
      discountApplied = null;
    }

    if ((paidAmount === null || paidAmount === undefined || (paidAmount === 0 && pkgPrice > 0 && !discountApplied)) && pkgPrice > 0) {
      paidAmount = originalPrice;
    }

    return {
      ...sub,
      hasRunningActivePlan,
      canActivateEarly,
      paidAmount,
      originalPrice,
      discountApplied,
    };
  });

  return {
    data: enrichedData,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  };
};

const activateEarly = async (tenantId: string, subscriptionId?: string): Promise<ISubscription> => {
  const query: any = {
    tenantId,
    status: 'active',
  };

  if (subscriptionId) {
    query._id = subscriptionId;
  } else {
    query.startDate = { $gt: new Date() };
  }

  const sub = await Subscription.findOne(query).sort({ startDate: 1 }).populate('packageId');
  if (!sub) {
    throw new CustomError(404, 'No upcoming subscription found to activate early');
  }

  // Safety check: Prevent early activation if another subscription is currently active and running
  const now = new Date();
  const currentRunningSub = await Subscription.findOne({
    tenantId,
    _id: { $ne: sub._id },
    status: 'active',
    startDate: { $lte: now },
    endDate: { $gte: now },
  });

  if (currentRunningSub) {
    throw new CustomError(
      400,
      'The store already has an active subscription running. The renewed plan will start automatically without gap when the current plan ends.'
    );
  }

  const pkg = (sub.packageId as any) || (await Package.findById(sub.packageId));
  sub.startDate = new Date();
  const newEnd = new Date(sub.startDate);
  if (pkg?.billingCycle === 'yearly') {
    newEnd.setFullYear(newEnd.getFullYear() + 1);
  } else {
    newEnd.setMonth(newEnd.getMonth() + 1);
  }
  sub.endDate = newEnd;
  sub.status = 'active';
  await sub.save();

  await notifySubscriptionUpdate(tenantId);
  return sub;
};

const updateSubscription = async (subscriptionId: string, payload: any): Promise<ISubscription> => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) {
    throw new CustomError(404, 'Subscription not found');
  }

  const prevStatus = subscription.status;
  if (payload.startDate) subscription.startDate = new Date(payload.startDate);
  if (payload.endDate) subscription.endDate = new Date(payload.endDate);
  if (payload.status) subscription.status = payload.status;
  
  await subscription.save();

  // If this subscription was cancelled, and admin requested activateNextImmediately:
  if (payload.status === 'cancelled' && prevStatus !== 'cancelled' && payload.activateNextImmediately) {
    try {
      await activateEarly(subscription.tenantId.toString());
    } catch (_) {}
  }

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
  activateEarly,
};
