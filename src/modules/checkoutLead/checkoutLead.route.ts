import express from 'express';
import { CheckoutLeadController } from './checkoutLead.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { checkoutLeadLimiter, dashboardLimiter } from '../../middleware/rateLimiter';

const router = express.Router();

// Public route for storefront to track leads (auto-fired via debounce)
router.post('/track', tenantMiddleware, checkoutLeadLimiter, CheckoutLeadController.trackLead);

// Protected route for merchant dashboard
router.get('/my-leads', authMiddleware('tenant_admin'), dashboardLimiter, CheckoutLeadController.getMerchantLeads);
router.get('/stats', authMiddleware('tenant_admin'), dashboardLimiter, CheckoutLeadController.getLeadStats);

export const CheckoutLeadRoutes = router;
