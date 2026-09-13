import { Order } from '../order/order.model';
import { FraudCheck } from './fraudCheck.model';
import { Subscription } from '../subscription/subscription.model';
import CustomError from '../../helpers/CustomError';

const checkFraud = async (orderId: string, tenantId: string, force: boolean = false) => {
  // 1. Subscription check
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('purchasedAddons.addonId');
  if (!subscription || !subscription.purchasedAddons) {
    throw new CustomError(403, 'No active add-ons found for this subscription');
  }

  const fraudAddon = subscription.purchasedAddons.find(
    (pa: any) => pa.addonId?.slug === 'fraud_check' && pa.status === 'active'
  );

  if (!fraudAddon) {
    throw new CustomError(403, 'Fraud check add-on is not active or purchased for this subscription');
  }

  // 2. Get order details
  const order = await Order.findOne({ _id: orderId, tenantId });
  if (!order) {
    throw new CustomError(404, 'Order not found');
  }

  // 3. Check if a fraud check already exists for this order
  let existingCheck = await FraudCheck.findOne({ orderId });
  if (existingCheck && !force) {
    // Return existing with a flag so frontend knows to ask if they want to recheck
    return { ...existingCheck.toObject(), isCached: true };
  }

  if (!existingCheck && fraudAddon.used >= fraudAddon.limit) {
    throw new CustomError(403, 'Fraud check limit reached. Please upgrade your add-on.');
  }

  if (existingCheck && force && fraudAddon.used >= fraudAddon.limit) {
    throw new CustomError(403, 'Fraud check limit reached. Cannot re-check.');
  }

  // 4. Global history analysis across ALL tenants
  const customerPhone = order.customerPhone;
  
  const historyStats = await Order.aggregate([
    { $match: { customerPhone } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        cancelledOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
        }
      }
    }
  ]);

  const stats = historyStats[0] || { totalOrders: 0, cancelledOrders: 0 };
  const cancellationRate = stats.totalOrders > 0 ? stats.cancelledOrders / stats.totalOrders : 0;

  let status: 'safe' | 'suspicious' | 'fraud' = 'safe';
  let score = 10;
  let details = 'Customer has good or no negative history.';

  if (stats.cancelledOrders >= 3 && cancellationRate > 0.5) {
    status = 'fraud';
    score = 90;
    details = `Platform-wide fraud detected: ${stats.cancelledOrders} cancelled orders out of ${stats.totalOrders}.`;
  } else if (stats.cancelledOrders >= 1 && cancellationRate > 0.3) {
    status = 'suspicious';
    score = 60;
    details = `Suspicious activity: ${stats.cancelledOrders} cancelled orders out of ${stats.totalOrders}.`;
  }

  if (existingCheck && force) {
    existingCheck.status = status;
    existingCheck.score = score;
    existingCheck.details = details;
    existingCheck.checkedAt = new Date();
    await existingCheck.save();
  } else {
    existingCheck = await FraudCheck.create({
      orderId,
      tenantId,
      customerPhone,
      customerName: order.customerName,
      status,
      score,
      details,
    });
  }

  // 5. Increment usage
  fraudAddon.used += 1;
  await subscription.save();

  return { ...existingCheck.toObject(), isCached: false };
};

const getMerchantFraudChecks = async (tenantId: string) => {
  return await FraudCheck.find({ tenantId }).populate('orderId').sort({ createdAt: -1 });
};

const getAllFraudChecks = async () => {
  return await FraudCheck.find().populate('orderId tenantId').sort({ createdAt: -1 });
};

const getCustomerStats = async (customerPhone: string) => {
  const historyStats = await Order.aggregate([
    { $match: { customerPhone } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        cancelledOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
        },
        deliveredOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
        },
        tenantIds: { $addToSet: '$tenantId' }
      }
    }
  ]);

  if (!historyStats.length) {
    return {
      totalOrders: 0,
      cancelledOrders: 0,
      deliveredOrders: 0,
      cancellationRate: 0,
      status: 'unknown',
      score: 0,
      details: 'No order history found for this phone number.',
      stores: []
    };
  }

  const stats = historyStats[0];
  const cancellationRate = stats.totalOrders > 0 ? stats.cancelledOrders / stats.totalOrders : 0;

  let status: 'safe' | 'suspicious' | 'fraud' = 'safe';
  let score = 10;
  let details = 'Customer has good or no negative history.';

  if (stats.cancelledOrders >= 3 && cancellationRate > 0.5) {
    status = 'fraud';
    score = 90;
    details = `Platform-wide fraud detected: ${stats.cancelledOrders} cancelled orders out of ${stats.totalOrders}.`;
  } else if (stats.cancelledOrders >= 1 && cancellationRate > 0.3) {
    status = 'suspicious';
    score = 60;
    details = `Suspicious activity: ${stats.cancelledOrders} cancelled orders out of ${stats.totalOrders}.`;
  }

  // Get Store names
  const { Tenant } = await import('../tenant/tenant.model');
  const stores = await Tenant.find({ _id: { $in: stats.tenantIds } }).select('name domain slug');

  return {
    totalOrders: stats.totalOrders,
    cancelledOrders: stats.cancelledOrders,
    deliveredOrders: stats.deliveredOrders,
    cancellationRate,
    status,
    score,
    details,
    stores
  };
};

export const FraudCheckService = {
  checkFraud,
  getMerchantFraudChecks,
  getAllFraudChecks,
  getCustomerStats,
};
