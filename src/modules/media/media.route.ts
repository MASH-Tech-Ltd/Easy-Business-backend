import { Router } from 'express';
import { MediaController } from './media.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { dashboardLimiter } from '../../middleware/rateLimiter';

const router = Router();

router.get('/usage/me', authMiddleware('tenant_admin'), dashboardLimiter, MediaController.getMyUsage);
router.get('/usage/platform', authMiddleware('super_admin'), dashboardLimiter, MediaController.getPlatformUsage);
router.get('/usage/tenant/:tenantId', authMiddleware('super_admin'), dashboardLimiter, MediaController.getTenantUsage);

export const MediaRoutes = router;
