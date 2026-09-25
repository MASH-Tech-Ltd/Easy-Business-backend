import { Order } from './order.model';
import CustomError from '../../helpers/CustomError';
import { IOrder } from './order.interface';
import { Customer } from '../customer/customer.model';
import { Product } from '../product/product.model';
import { getIO } from '../../socket';
import { Notification } from '../notification/notification.model';
import { Theme } from '../theme/theme.model';
import { computeShipping } from '../../utils/computeShipping';
import { paginationHelper } from '../../helpers/paginationHelper';
import { User } from '../auth/auth.model';
import mongoose from 'mongoose';

const createOrder = async (payload: IOrder): Promise<IOrder> => {
  // ─── SECURITY: Recalculate shipping from the DB, ignore client-sent values ───
  // Extract the shipping address parts (expected format: "street, upazila, district, division")
  const addressParts = (payload.shippingAddress || '').split(',').map((p: string) => p.trim());
  const district = addressParts[addressParts.length - 2] || '';
  const division = addressParts[addressParts.length - 1] || '';

  try {
    // ── Step 1: Fetch real product prices from DB (prevents client price manipulation) ──
    const productIds = payload.items.map((item: any) => item.productId);
    const dbProducts = await Product.find(
      { _id: { $in: productIds }, tenantId: payload.tenantId },
      { _id: 1, discountedPrice: 1, originalPrice: 1 }
    );

    // Build a map of productId → trusted price
    const priceMap = new Map<string, number>(
      dbProducts.map((p: any) => [p._id.toString(), p.discountedPrice ?? p.originalPrice])
    );

    // Override each item's price with the real DB value and reject unknown products
    for (const item of payload.items as any[]) {
      const trustedPrice = priceMap.get(item.productId.toString());
      if (trustedPrice === undefined) {
        console.error('DEBUG priceMap keys:', Array.from(priceMap.keys()));
        console.error('DEBUG item.productId:', item.productId, typeof item.productId);
        console.error('DEBUG payload.tenantId:', payload.tenantId);
        throw new Error(`Product not found or does not belong to this tenant: ${item.productId}`);
      }
      item.price = trustedPrice; // overwrite client-supplied price
    }

    // ── Step 2: Recompute subTotal from now-trusted item prices ──────────────────
    const trustedSubTotal = payload.items.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0
    );

    // ── Step 3: Recalculate shipping from DB ────────────────────────────────────
    const theme = await Theme.findOne({ tenantId: payload.tenantId }).select(
      'shippingZones defaultShippingCost'
    );
    const zones = theme?.shippingZones || [];
    const defaultCost = theme?.defaultShippingCost ?? 120;
    const { cost: trustedShippingCharge } = computeShipping(
      division,
      district,
      zones as any[],
      defaultCost
    );

    // ── Step 4: Override ALL money fields — client values are fully ignored ──────
    payload.subTotal = Math.round(trustedSubTotal);
    payload.shippingCharge = trustedShippingCharge;
    payload.totalPrice = Math.round(trustedSubTotal + trustedShippingCharge);
  } catch (err) {
    // SECURITY: Do NOT fall through — if price recalculation fails, reject the order entirely
    // to prevent client-manipulated prices from being saved.
    throw new CustomError(400, `Order rejected: could not verify product prices. Please try again. (${(err as Error).message})`);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  let newOrderId = '';
  let isUnique = false;
  while (!isUnique) {
    newOrderId = Math.floor(100000 + Math.random() * 900000).toString();
    const existing = await Order.findOne({ orderId: newOrderId });
    if (!existing) isUnique = true;
  }
  payload.orderId = newOrderId;

  const result = await Order.create(payload);

  try {
    const existingCustomer = await Customer.findOne({ 
      phone: payload.customerPhone, 
      tenantId: payload.tenantId 
    });

    if (existingCustomer) {
      await Customer.findByIdAndUpdate(existingCustomer._id, {
        $inc: { totalOrders: 1, totalSpent: payload.totalPrice },
        $set: { name: payload.customerName }
      });
    } else {
      await Customer.create({
        name: payload.customerName,
        phone: payload.customerPhone,
        tenantId: payload.tenantId,
        totalOrders: 1,
        totalSpent: payload.totalPrice
      });
    }
  } catch (error) {
    console.error('Error tracking customer details:', error);
  }

  try {
    const io = getIO();
    io.to(`tenant_${payload.tenantId}`).emit('new_order', result);

    // Create database notification for the merchant
    const tenantAdmin = await User.findOne({ tenantId: payload.tenantId, role: 'tenant_admin' });
    if (tenantAdmin) {
      const notification = await Notification.create({
        recipientId: tenantAdmin._id,
        tenantId: payload.tenantId,
        type: 'NEW_ORDER',
        title: 'New Order Received',
        message: `Order from ${payload.customerName} for ${payload.totalPrice} BDT`,
        relatedEntityId: result._id
      });
      // Emit to the merchant's personal user room so the NotificationBell component updates
      io.to(`user_${tenantAdmin._id}`).emit('new_notification', notification);
    }
  } catch (error) {
    console.error('Socket emit error for new_order:', error);
  }

  return result;
};

const getOrdersByTenant = async (tenantId: string, query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query.page, query.limit);
  
  const filter: any = { tenantId };
  
  if (query.status && query.status !== 'all') {
    filter.status = query.status;
  }
  
  if (query.search) {
    filter.$or = [
      { customerName: { $regex: query.search, $options: 'i' } },
      { customerPhone: { $regex: query.search, $options: 'i' } },
    ];
  }

  const [data, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter)
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

const updateOrder = async (id: string, payload: Partial<IOrder>, tenantId: string) => {
  const order = await Order.findOne({ _id: id, tenantId });
  if (!order) return null;

  const oldStatus = order.status;
  const newStatus = payload.status || oldStatus;
  
  const isOldCompleted = ['confirmed', 'shipped', 'delivered'].includes(oldStatus);
  const isNewCompleted = ['confirmed', 'shipped', 'delivered'].includes(newStatus);
  
  // Check if items are being modified
  const itemsChanged = !!payload.items;

  // 1. Revert old stock if the order was completed AND (it is now cancelled/pending OR the items are changing)
  if (isOldCompleted && (!isNewCompleted || itemsChanged)) {
    try {
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { salesCount: -item.quantity, stock: item.quantity }
        });
      }
    } catch (e) {
      console.error("Error reverting product counts:", e);
    }
  }

  // Perform the update
  const result = await Order.findOneAndUpdate({ _id: id, tenantId }, payload, { returnDocument: 'after' });

  // 2. Apply new stock if the order is now completed AND (it was previously not completed OR the items changed)
  if (result && isNewCompleted && (!isOldCompleted || itemsChanged)) {
    try {
      for (const item of result.items) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { salesCount: item.quantity, stock: -item.quantity }
        });
      }
    } catch (e) {
      console.error("Error updating product counts:", e);
    }
  }

  return result;
};

const deleteOrder = async (id: string, tenantId: string) => {
  const result = await Order.findOneAndDelete({ _id: id, tenantId });
  return result;
};

const getOrderById = async (id: string, tenantId?: string) => {
  const cleanId = id.replace(/^#/, '');
  
  let query: any = { orderId: cleanId };
  if (tenantId) query.tenantId = tenantId;
  
  const result = await Order.findOne(query);
  return result;
};

export const OrderService = {
  createOrder,
  getOrdersByTenant,
  updateOrder,
  deleteOrder,
  getOrderById,
};
