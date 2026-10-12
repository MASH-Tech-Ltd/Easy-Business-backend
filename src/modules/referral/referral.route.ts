import { Router } from 'express';
import { ReferralController } from './referral.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Public route to validate a referral code (used on merchant registration form)
router.get('/validate/:code', ReferralController.validateCode);

// Merchant Protected routes
router.get('/merchant/my-referral', authMiddleware('tenant_admin'), ReferralController.getMyMerchantReferral);
router.post('/merchant/withdraw', authMiddleware('tenant_admin'), ReferralController.requestPointsWithdrawal);

// Super Admin Withdrawals management
router.get('/withdrawals', authMiddleware('super_admin'), ReferralController.getAllWithdrawals);
router.patch('/withdrawals/:id/process', authMiddleware('super_admin'), ReferralController.processWithdrawal);

// Protected Super Admin referral code management routes
router.get('/', authMiddleware('super_admin'), ReferralController.getAllReferrals);
router.post('/', authMiddleware('super_admin'), ReferralController.createReferral);
router.get('/usages', authMiddleware('super_admin'), ReferralController.getReferralUsages);
router.get('/:id', authMiddleware('super_admin'), ReferralController.getReferralById);
router.patch('/:id', authMiddleware('super_admin'), ReferralController.updateReferral);
router.patch('/:id/toggle-status', authMiddleware('super_admin'), ReferralController.toggleStatus);
router.delete('/:id', authMiddleware('super_admin'), ReferralController.deleteReferral);

export const ReferralRoutes = router;
