import { Request, Response } from 'express';
import { notificationService } from './notification.service';

export const getMyNotifications = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const notifications = await notificationService.getUserNotifications(userId);
    res.status(200).json({ success: true, data: notifications });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user._id;

    // SECURITY FIX (IDOR): Scope markAsRead to the caller's userId so a user cannot
    // mark another user's notifications as read by guessing or brute-forcing notification IDs.
    const notification = await notificationService.markAsRead(id as string, userId.toString());
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found or not authorized' });
    }
    res.status(200).json({ success: true, data: notification });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    await notificationService.markAllAsRead(userId);
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
