import { Router } from 'express';
import { AnalyticsController } from './analytics.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { storefrontPublicLimiter, dashboardLimiter } from '../../middleware/rateLimiter';

const router = Router();

// Legacy & Storefront Visit Routes
router.get('/dashboard-stats', authMiddleware('tenant_admin'), dashboardLimiter, AnalyticsController.getDashboardStats);
router.get('/dashboard-summary', authMiddleware('tenant_admin'), dashboardLimiter, AnalyticsController.getDashboardSummary);
router.get('/super-admin-stats', authMiddleware('super_admin'), dashboardLimiter, AnalyticsController.getSuperAdminStats);
router.get('/public-stats', AnalyticsController.getPublicStats);
router.post('/visit', storefrontPublicLimiter, AnalyticsController.recordVisit);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Public Analytics Tracking (Batched Product Impressions, Clicks, Store Visits)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/track', storefrontPublicLimiter, AnalyticsController.trackEvents);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Merchant Analytics Endpoints (Role: tenant_admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/merchant/overview', authMiddleware('tenant_admin'), dashboardLimiter, AnalyticsController.getMerchantOverview);
router.get('/merchant/timeline', authMiddleware('tenant_admin'), dashboardLimiter, AnalyticsController.getMerchantTimeline);
router.get('/merchant/top-products', authMiddleware('tenant_admin'), dashboardLimiter, AnalyticsController.getMerchantTopProducts);
router.get('/merchant/products', authMiddleware('tenant_admin'), dashboardLimiter, AnalyticsController.getMerchantProducts);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Super Admin Analytics Endpoints (Role: super_admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/overview', authMiddleware('super_admin'), dashboardLimiter, AnalyticsController.getAdminOverview);
router.get('/admin/merchants', authMiddleware('super_admin'), dashboardLimiter, AnalyticsController.getAdminMerchants);
router.get('/admin/merchant/:tenantId', authMiddleware('super_admin'), dashboardLimiter, AnalyticsController.getAdminMerchantDetails);
router.get('/admin/merchant/:tenantId/products', authMiddleware('super_admin'), dashboardLimiter, AnalyticsController.getAdminMerchantProducts);
router.get('/admin/merchant/:tenantId/timeline', authMiddleware('super_admin'), dashboardLimiter, AnalyticsController.getAdminMerchantTimeline);

export const AnalyticsRoutes = router;
