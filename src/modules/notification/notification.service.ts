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

  async getUserNotifications(userId: string) {
    return Notification.find({ recipientId: userId }).sort({ createdAt: -1 }).limit(50);
  },

  async markAsRead(notificationId: string) {
    return Notification.findByIdAndUpdate(notificationId, { read: true }, { new: true });
  },

  async markAllAsRead(userId: string) {
    return Notification.updateMany({ recipientId: userId, read: false }, { read: true });
  }
};
