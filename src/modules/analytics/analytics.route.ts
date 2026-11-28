import { Router } from 'express';
import { AnalyticsController } from './analytics.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { storefrontPublicLimiter, dashboardLimiter } from '../../middleware/rateLimiter';
import { cacheResponse } from '../../services/cache/cache.middleware';
import { CacheKeys, hashObject } from '../../services/cache/cache.keys';
import { CACHE_TTL } from '../../services/cache/cache.ttl';

const router = Router();

// Legacy & Storefront Visit Routes
router.get(
  '/dashboard-stats',
  authMiddleware('tenant_admin'),
  dashboardLimiter,
  cacheResponse({
    group: 'merchant_dashboard',
    ttlSeconds: CACHE_TTL.DASHBOARD,
    keyBuilder: (req) => CacheKeys.merchantDashboardStats(String((req as any).user.tenantId), Number(req.query.days) || 30),
  }),
  AnalyticsController.getDashboardStats
);
router.get(
  '/dashboard-summary',
  authMiddleware('tenant_admin'),
  dashboardLimiter,
  cacheResponse({
    group: 'merchant_dashboard',
    ttlSeconds: CACHE_TTL.DASHBOARD,
    keyBuilder: (req) => CacheKeys.merchantDashboardSummary(String((req as any).user.tenantId), Number(req.query.days) || 30),
  }),
  AnalyticsController.getDashboardSummary
);
router.get(
  '/super-admin-stats',
  authMiddleware('super_admin'),
  dashboardLimiter,
  cacheResponse({
    group: 'admin_dashboard',
    ttlSeconds: CACHE_TTL.DASHBOARD,
    keyBuilder: () => CacheKeys.adminDashboardSuperStats(),
  }),
  AnalyticsController.getSuperAdminStats
);
router.get(
  '/public-stats',
  cacheResponse({
    group: 'admin_dashboard',
    ttlSeconds: 120,
    keyBuilder: () => CacheKeys.publicPlatformStats(),
  }),
  AnalyticsController.getPublicStats
);
router.post('/visit', storefrontPublicLimiter, AnalyticsController.recordVisit);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Public Analytics Tracking (Batched Product Impressions, Clicks, Store Visits)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/track', storefrontPublicLimiter, AnalyticsController.trackEvents);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Merchant Analytics Endpoints (Role: tenant_admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/merchant/overview',
  authMiddleware('tenant_admin'),
  dashboardLimiter,
  cacheResponse({
    group: 'merchant_dashboard',
    ttlSeconds: CACHE_TTL.DASHBOARD,
    keyBuilder: (req) => CacheKeys.merchantAnalytics(String((req as any).user.tenantId), 'overview', req.query as Record<string, unknown>),
  }),
  AnalyticsController.getMerchantOverview
);
router.get(
  '/merchant/timeline',
  authMiddleware('tenant_admin'),
  dashboardLimiter,
  cacheResponse({
    group: 'merchant_dashboard',
    ttlSeconds: CACHE_TTL.DASHBOARD,
    keyBuilder: (req) => CacheKeys.merchantAnalytics(String((req as any).user.tenantId), 'timeline', req.query as Record<string, unknown>),
  }),
  AnalyticsController.getMerchantTimeline
);
router.get(
  '/merchant/top-products',
  authMiddleware('tenant_admin'),
  dashboardLimiter,
  cacheResponse({
    group: 'merchant_dashboard',
    ttlSeconds: CACHE_TTL.DASHBOARD,
    keyBuilder: (req) => CacheKeys.merchantAnalytics(String((req as any).user.tenantId), 'top-products', req.query as Record<string, unknown>),
  }),
  AnalyticsController.getMerchantTopProducts
);
router.get('/merchant/products', authMiddleware('tenant_admin'), dashboardLimiter, AnalyticsController.getMerchantProducts);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Super Admin Analytics Endpoints (Role: super_admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/admin/overview',
  authMiddleware('super_admin'),
  dashboardLimiter,
  cacheResponse({
    group: 'admin_dashboard',
    ttlSeconds: CACHE_TTL.DASHBOARD,
    keyBuilder: (req) => CacheKeys.adminDashboardOverview(req.query as Record<string, unknown>),
  }),
  AnalyticsController.getAdminOverview
);
router.get(
  '/admin/merchants',
  authMiddleware('super_admin'),
  dashboardLimiter,
  cacheResponse({
    group: 'admin_dashboard',
    ttlSeconds: CACHE_TTL.DASHBOARD,
    keyBuilder: (req) => CacheKeys.adminDashboardMerchants(req.query as Record<string, unknown>),
  }),
  AnalyticsController.getAdminMerchants
);
router.get('/admin/merchant/:tenantId', authMiddleware('super_admin'), dashboardLimiter, AnalyticsController.getAdminMerchantDetails);
router.get('/admin/merchant/:tenantId/products', authMiddleware('super_admin'), dashboardLimiter, AnalyticsController.getAdminMerchantProducts);
router.get('/admin/merchant/:tenantId/timeline', authMiddleware('super_admin'), dashboardLimiter, AnalyticsController.getAdminMerchantTimeline);

export const AnalyticsRoutes = router;
