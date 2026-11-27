import { Router } from 'express';
import { ResourceController as C } from './resource.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { dashboardLimiter } from '../../middleware/rateLimiter';

const router = Router();
const admin = [authMiddleware('super_admin'), dashboardLimiter] as const;
const merchant = [authMiddleware('tenant_admin'), dashboardLimiter] as const;

// Merchant (tenant resolved from the verified JWT, never from the request body/query)
router.get('/me/overview', ...merchant, C.myOverview);
router.get('/addons', ...merchant, C.listAddons);
router.post('/addons/purchase', ...merchant, C.purchaseAddon);
router.get('/addons/my-purchases', ...merchant, C.myPurchases);

// Super Admin — Global Settings → Resource & Bandwidth Management
router.get('/admin/settings', ...admin, C.getSettings);
router.put('/admin/settings', ...admin, C.updateSettings);

router.get('/admin/packages', ...admin, C.listPackageResources);
router.put('/admin/packages/:id', ...admin, C.updatePackageResources);

router.get('/admin/addons', ...admin, C.adminListAddons);
router.post('/admin/addons', ...admin, C.adminCreateAddon);
router.put('/admin/addons/:id', ...admin, C.adminUpdateAddon);
router.patch('/admin/addons/:id/active', ...admin, C.adminToggleAddon);
router.delete('/admin/addons/:id', ...admin, C.adminDeleteAddon);

router.get('/admin/purchases', ...admin, C.adminPurchases);
router.post('/admin/purchases/:id/refund', ...admin, C.adminRefund);

router.get('/admin/analytics', ...admin, C.adminAnalytics);
router.get('/admin/merchants', ...admin, C.adminMerchantsUsage);
router.get('/admin/tenants/:tenantId/overview', ...admin, C.adminTenantOverview);
router.post('/admin/tenants/:tenantId/reconcile-storage', ...admin, C.adminReconcile);
router.get('/admin/audit-logs', ...admin, C.adminAuditLogs);
router.get('/admin/ingest-status', ...admin, C.adminIngestStatus);
router.post('/admin/ingest/run', ...admin, C.adminRunIngest);
router.post('/admin/dev/mock-events', ...admin, C.adminMockEvents);

export const ResourceRoutes = router;
