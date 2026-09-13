import { Router } from 'express';
import { FraudCheckController } from './fraudCheck.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// SuperAdmin route
router.get('/customer-stats', authMiddleware('super_admin'), FraudCheckController.getCustomerStats);
router.get(
  '/all',
  authMiddleware('super_admin'),
  FraudCheckController.getAllFraudChecks
);

// Tenant routes
router.post(
  '/check',
  authMiddleware('tenant_admin'),
  FraudCheckController.checkFraud
);

router.get(
  '/merchant',
  authMiddleware('tenant_admin'),
  FraudCheckController.getMerchantFraudChecks
);

export const FraudCheckRoutes = router;
