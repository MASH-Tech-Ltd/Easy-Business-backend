import { Request, Response } from 'express';
import { notificationService } from './notification.service';
import { SmsService } from './sms.service';

export const getMyNotifications = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const data = await notificationService.getUserNotifications(userId, req.query);
    res.status(200).json({ success: true, data });
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

export const getSmsBalance = async (_req: Request, res: Response) => {
  try {
    const data = await SmsService.getCreditBalance();
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const sendManualSms = async (req: Request, res: Response) => {
  try {
    const adminUserId = String((req as any).user._id);
    const { tenantIds, phone, message } = req.body || {};
    const data = await SmsService.sendManualAdminSms({ adminUserId, tenantIds, phone, message });
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const getSmsLogs = async (req: Request, res: Response) => {
  try {
    const data = await SmsService.getSmsSummaryAndLogs(req.query as any);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMySmsStats = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is required' });
    }
    const data = await SmsService.getMerchantSmsStats(String(tenantId), req.query as any);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const sendOrderConfirmationSms = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const userId = (req as any).user?._id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is required' });
    }
    const data = await SmsService.sendOrderConfirmationSms({
      tenantId: String(tenantId),
      orderId: String(req.params.orderId),
      userId: userId ? String(userId) : null,
    });
    res.status(200).json({ success: true, message: 'Order confirmation SMS sent successfully', data });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const resendSms = async (req: Request, res: Response) => {
  try {
    const adminUserId = String((req as any).user._id);
    const data = await SmsService.resendSmsLog(String(req.params.id), adminUserId);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ success: false, message: error.message });
  }
};
