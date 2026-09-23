import { Router } from 'express';
import { AnalyticsController } from './analytics.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

router.get('/dashboard-stats', authMiddleware('tenant_admin'), AnalyticsController.getDashboardStats);
router.get('/dashboard-summary', authMiddleware('tenant_admin'), AnalyticsController.getDashboardSummary);
router.get('/super-admin-stats', authMiddleware('super_admin'), AnalyticsController.getSuperAdminStats);
router.get('/public-stats', AnalyticsController.getPublicStats);
router.post('/visit', AnalyticsController.recordVisit);

export const AnalyticsRoutes = router;
