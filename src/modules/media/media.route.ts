import { Router } from 'express';
import { MediaController } from './media.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { dashboardLimiter } from '../../middleware/rateLimiter';

const router = Router();

router.get('/usage/me', authMiddleware('tenant_admin'), dashboardLimiter, MediaController.getMyUsage);
router.get('/usage/platform', authMiddleware('super_admin'), dashboardLimiter, MediaController.getPlatformUsage);
router.get('/usage/tenant/:tenantId', authMiddleware('super_admin'), dashboardLimiter, MediaController.getTenantUsage);

router.get('/migration/scan/:tenantId', authMiddleware('super_admin'), dashboardLimiter, MediaController.scanMigration);
router.post('/migration/run/:tenantId', authMiddleware('super_admin'), dashboardLimiter, MediaController.runMigration);
router.post('/migration/cleanup/:tenantId', authMiddleware('super_admin'), dashboardLimiter, MediaController.cleanupMigration);
router.get('/migration/history/:tenantId', authMiddleware('super_admin'), dashboardLimiter, MediaController.migrationHistory);

export const MediaRoutes = router;
