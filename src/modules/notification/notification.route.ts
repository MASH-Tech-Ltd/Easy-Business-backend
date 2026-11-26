import { Router } from 'express';
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  getSmsBalance,
  sendManualSms,
  getSmsLogs,
  getMySmsStats,
  resendSms,
} from './notification.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Admin SMS Notification & Balance routes
router.get('/sms/balance', authMiddleware('super_admin'), getSmsBalance);
router.get('/sms/logs', authMiddleware('super_admin'), getSmsLogs);
router.post('/sms/send', authMiddleware('super_admin'), sendManualSms);
router.post('/sms/resend/:id', authMiddleware('super_admin'), resendSms);

// Merchant SMS count/logs
router.get('/sms/my-stats', authMiddleware('tenant_admin'), getMySmsStats);

// Routes available to merchants, admins, and affiliate partners
router.use(authMiddleware('tenant_admin', 'super_admin', 'affiliate_partner'));

router.get('/my-notifications', getMyNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);

export const NotificationRoutes = router;
