import { ISubscription } from './subscription.interface';
import { Subscription } from './subscription.model';
import { Package } from '../package/package.model';
import CustomError from '../../helpers/CustomError';

const assignPackage = async (payload: { tenantId: string, packageId: string }): Promise<ISubscription> => {
  const selectedPackage = await Package.findById(payload.packageId);
  if (!selectedPackage) {
    throw new CustomError(404, 'Package not found');
  }

  const startDate = new Date();
  const endDate = new Date();
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
  // Find the most recent active/pending subscription
  let result = await Subscription.findOne(
    { tenantId, status: { $in: ['active', 'pending'] } },
    null,
    { sort: { createdAt: -1 } }
  ).populate('packageId');

  // Backward compatibility: If no active/pending subscription exists,
  // check if they have ANY subscription history (including expired ones).
  if (!result) {
    const hasAnySubscription = await Subscription.exists({ tenantId });
    
    if (!hasAnySubscription) {
      const trialStart = new Date();
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 5);
      
      result = await Subscription.create({
        tenantId,
        startDate: trialStart,
        endDate: trialEnd,
        status: 'active',
        isTrial: true,
      });
    }
  }

  // Lazy expiry: if the active subscription has passed its endDate, mark it expired
  if (result && result.status === 'active' && new Date(result.endDate) < new Date()) {
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
  const startDate = new Date();
  const endDate = new Date();
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

const getAllSubscriptions = async (): Promise<ISubscription[]> => {
  // Sort pending requests at the top, then sort by createdAt descending
  const subscriptions = await Subscription.find({})
    .populate({
      path: 'tenantId',
      populate: { path: 'ownerId', select: 'email name' }
    })
    .populate('packageId')
    .sort({ status: -1, createdAt: -1 }); 
  // Note: in mongoose sort, sorting by status string will sort alphabetically (active, cancelled, expired, pending).
  // 'pending' starts with p, so it comes last. We should probably sort in JS or use an aggregation to guarantee pending is first.
  
  // Custom sort in JS to ensure 'pending' is at the very top:
  return subscriptions.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });
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
