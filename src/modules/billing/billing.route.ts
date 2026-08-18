import { Router } from 'express';
import { BillingController } from './billing.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// These should ideally be protected by authMiddleware('super_admin')
router.get('/overview', BillingController.getBillingOverview);

export const BillingRoutes = router;
