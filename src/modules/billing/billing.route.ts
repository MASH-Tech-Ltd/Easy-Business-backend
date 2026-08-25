import { Router } from 'express';
import { BillingController } from './billing.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// SECURITY FIX: Billing data requires super_admin authentication
router.get('/overview', authMiddleware('super_admin'), BillingController.getBillingOverview);

export const BillingRoutes = router;
