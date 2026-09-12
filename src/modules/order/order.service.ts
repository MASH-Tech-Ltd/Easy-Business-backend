import { Order } from './order.model';
import { IOrder } from './order.interface';
import { Customer } from '../customer/customer.model';
import { Product } from '../product/product.model';
import { getIO } from '../../socket';
import { Notification } from '../notification/notification.model';

const createOrder = async (payload: IOrder): Promise<IOrder> => {
  let newOrderId;
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

import { paginationHelper } from '../../helpers/paginationHelper';
import { User } from '../auth/auth.model';

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
  const result = await Order.findOneAndUpdate({ _id: id, tenantId }, payload, { new: true });

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

import mongoose from 'mongoose';

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
