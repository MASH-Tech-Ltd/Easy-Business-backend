import { Order } from '../order/order.model';
import { FraudCheck } from './fraudCheck.model';
import CustomError from '../../helpers/CustomError';

const checkFraud = async (orderId: string, tenantId: string) => {
  // 1. Get order details
  const order = await Order.findOne({ _id: orderId, tenantId });
  if (!order) {
    throw new CustomError(404, 'Order not found');
  }

  // 2. Check if a fraud check already exists for this order
  let existingCheck = await FraudCheck.findOne({ orderId });
  if (existingCheck) {
    return existingCheck;
  }

  // 3. Check historical records by customer phone across the database
  const previousChecks = await FraudCheck.find({ customerPhone: order.customerPhone });
  
  if (previousChecks.length > 0) {
    // If we have previous history, we can aggregate or use the worst status
    const hasFraud = previousChecks.some(c => c.status === 'fraud');
    const hasSuspicious = previousChecks.some(c => c.status === 'suspicious');
    
    const newCheck = await FraudCheck.create({
      orderId,
      tenantId,
      customerPhone: order.customerPhone,
      customerName: order.customerName,
      status: hasFraud ? 'fraud' : (hasSuspicious ? 'suspicious' : 'safe'),
      score: hasFraud ? 90 : (hasSuspicious ? 60 : 10),
      details: hasFraud ? 'Matched historical fraud record.' : 'Historical data found.',
    });
    return newCheck;
  }

  // 4. If no history, simulate a 3rd party API call
  // Mock logic: randomly generate a score
  const randomScore = Math.floor(Math.random() * 100);
  let status: 'safe' | 'suspicious' | 'fraud' = 'safe';
  if (randomScore > 80) status = 'fraud';
  else if (randomScore > 50) status = 'suspicious';

  const newCheck = await FraudCheck.create({
    orderId,
    tenantId,
    customerPhone: order.customerPhone,
    customerName: order.customerName,
    status,
    score: randomScore,
    details: 'Checked via simulated external API.',
  });

  return newCheck;
};

const getMerchantFraudChecks = async (tenantId: string) => {
  return await FraudCheck.find({ tenantId }).populate('orderId').sort({ createdAt: -1 });
};

const getAllFraudChecks = async () => {
  return await FraudCheck.find().populate('orderId tenantId').sort({ createdAt: -1 });
};

export const FraudCheckService = {
  checkFraud,
  getMerchantFraudChecks,
  getAllFraudChecks,
};
