import { Notification } from './notification.model';
import { Types } from 'mongoose';

export const notificationService = {
  async createNotification(
    recipientId: string | Types.ObjectId,
    type: string,
    title: string,
    message: string,
    relatedEntityId?: string | Types.ObjectId,
    tenantId?: string | Types.ObjectId
  ) {
    const notification = await Notification.create({
      recipientId: recipientId as Types.ObjectId,
      tenantId: tenantId as Types.ObjectId,
      type,
      title,
      message,
      relatedEntityId: relatedEntityId as Types.ObjectId,
    });

    // Emit event to recipient's room
    try {
      const io = require('../../socket').getIO();
      io.to(`user_${recipientId.toString()}`).emit('new_notification', notification);
    } catch (error) {
      console.error('Failed to emit notification socket event:', error);
    }

    return notification;
  },

  async getUserNotifications(userId: string, query: any = {}) {
    const { page = 1, limit = 50, search, type, isRead, sortBy = 'newest' } = query;
    const filter: any = { recipientId: userId };
    
    if (type && type !== 'all') filter.type = type;
    if (isRead !== undefined && isRead !== 'all') filter.read = isRead === 'true';
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } }
      ];
    }
    
    const sortParams: any = { createdAt: sortBy === 'oldest' ? 1 : -1 };
    const skip = (Number(page) - 1) * Number(limit);
    
    const [notifications, total, types] = await Promise.all([
      Notification.find(filter).sort(sortParams).skip(skip).limit(Number(limit)),
      Notification.countDocuments(filter),
      Notification.distinct('type', { recipientId: userId })
    ]);
    
    return {
      notifications,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      availableTypes: types
    };
  },

  // SECURITY FIX (IDOR): Scope update to the owner — prevents marking other users' notifications as read
  async markAsRead(notificationId: string, userId: string) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, recipientId: userId },
      { read: true },
      { returnDocument: 'after' }
    );
  },

  async markAllAsRead(userId: string) {
    return Notification.updateMany({ recipientId: userId, read: false }, { read: true });
  }
};
