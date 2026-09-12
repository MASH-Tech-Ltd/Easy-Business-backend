import { ISubscription } from './subscription.interface';
import { Subscription } from './subscription.model';
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

  const startDate = (lastSub && lastSub.endDate) ? new Date(lastSub.endDate) : new Date();
  const endDate = new Date(startDate);

  if (selectedPackage.billingCycle === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  // Deactivate any existing active subscriptions for this tenant
  await Subscription.updateMany({ tenantId: payload.tenantId, status: 'active' }, { status: 'cancelled' });

  const subscription = await Subscription.create({
    tenantId: payload.tenantId,
    packageId: payload.packageId,
    startDate,
    endDate,
    status: 'active',
  });

  return subscription;
};

const getTenantSubscription = async (tenantId: string): Promise<ISubscription | null> => {
  // Sort by endDate DESC so the subscription with the furthest expiry is checked first.
  // This prevents an older expired record from shadowing a valid active one.
  let result = await Subscription.findOne(
    { tenantId, status: { $in: ['active', 'pending'] } },
    null,
    { sort: { endDate: -1 } }
  ).populate('packageId');

  // Lazy expiry: if the active subscription has passed its endDate, mark it expired
  if (result && result.status === 'active' && new Date(result.endDate).getTime() < Date.now()) {
    result.status = 'expired';
    await result.save();
    // Return null so callers treat this as "no active subscription"
    return null;
  }

  return result;
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
    startDate: new Date(), // Placeholder
    endDate: new Date(), // Placeholder
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

  const startDate = (lastSub && lastSub.endDate) ? new Date(lastSub.endDate) : new Date();
  const endDate = new Date(startDate);

  if (selectedPackage.billingCycle === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  // Deactivate any existing active subscriptions for this tenant
  await Subscription.updateMany({ tenantId: subscription.tenantId, status: 'active' }, { status: 'cancelled' });

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

export const SubscriptionService = {
  assignPackage,
  getTenantSubscription,
  requestPackage,
  approveSubscription,
  rejectSubscription,
  getAllSubscriptions,
  updateSubscription,
  deleteSubscription,
};
