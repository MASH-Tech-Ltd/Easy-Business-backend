import { Router } from 'express';
import { BillingController } from './billing.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { BillingValidation } from './billing.validation';

const router = Router();

// Platform Payment Accounts (Configured by Super Admin, viewed by Merchants)
router.get('/platform-payment-settings', authMiddleware('tenant_admin', 'super_admin'), BillingController.getPlatformPaymentSettings);
router.put(
  '/platform-payment-settings',
  authMiddleware('super_admin'),
  validateRequest(BillingValidation.updatePlatformPaymentSettingsValidation),
  BillingController.updatePlatformPaymentSettings
);

// Merchant Payment Proof Submissions
router.post(
  '/submit-payment',
  authMiddleware('tenant_admin'),
  validateRequest(BillingValidation.submitPaymentProofValidation),
  BillingController.submitPaymentProof
);
router.get('/my-payments', authMiddleware('tenant_admin'), BillingController.getMyPaymentSubmissions);
router.put(
  '/my-payments/:id',
  authMiddleware('tenant_admin'),
  validateRequest(BillingValidation.updatePaymentProofValidation),
  BillingController.updateMyPaymentSubmission
);


// Super Admin Payment Verification
router.get('/all-payments', authMiddleware('super_admin'), BillingController.getAllPaymentSubmissions);
router.put(
  '/verify-payment/:id',
  authMiddleware('super_admin'),
  validateRequest(BillingValidation.verifyPaymentSubmissionValidation),
  BillingController.verifyPaymentSubmission
);

// Billing Overview Stats
router.get('/overview', authMiddleware('super_admin'), BillingController.getBillingOverview);

export const BillingRoutes = router;

