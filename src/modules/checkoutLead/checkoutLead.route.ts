import express from 'express';
import { CheckoutLeadController } from './checkoutLead.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';

const router = express.Router();

// Public route for storefront to track leads (uses tenantMiddleware to find tenant via origin)
router.post('/track', tenantMiddleware, CheckoutLeadController.trackLead);

// Protected route for merchant dashboard
router.get('/my-leads', authMiddleware('tenant_admin'), CheckoutLeadController.getMerchantLeads);
router.get('/stats', authMiddleware('tenant_admin'), CheckoutLeadController.getLeadStats);

export const CheckoutLeadRoutes = router;
