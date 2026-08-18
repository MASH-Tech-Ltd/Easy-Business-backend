import { Router } from 'express';
import { getMyNotifications, markAsRead, markAllAsRead } from './notification.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Routes available to both merchants and admins
router.use(authMiddleware('tenant_admin', 'super_admin'));

router.get('/my-notifications', getMyNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);

export const NotificationRoutes = router;
