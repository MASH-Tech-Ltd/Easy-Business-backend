import { Router } from 'express';
import { getMyNotifications, markAsRead, markAllAsRead } from './notification.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Routes available to merchants, admins, and affiliate partners
router.use(authMiddleware('tenant_admin', 'super_admin', 'affiliate_partner'));

router.get('/my-notifications', getMyNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);

export const NotificationRoutes = router;
