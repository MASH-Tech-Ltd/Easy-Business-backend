import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { authLimiter } from '../../middleware/rateLimiter';
import { AffiliateController } from './affiliate.controller';
import { AffiliateValidation } from './affiliate.validation';
import {
  requireAffiliatePartner,
  affiliateWithdrawalLimiter,
  affiliateProfileLimiter,
  affiliatePublicClickLimiter,
} from './affiliate.middleware';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Public & Authentication Routes
// ─────────────────────────────────────────────────────────────────────────────
router.get('/public-config', AffiliateController.getPublicConfig);
router.get(
  '/validate-code/:code',
  affiliatePublicClickLimiter,
  AffiliateController.validateCode
);
router.post('/track-click', affiliatePublicClickLimiter, AffiliateController.trackClick);

router.post(
  '/register',
  authLimiter,
  validateRequest(AffiliateValidation.registerAffiliateSchema),
  AffiliateController.register
);

router.post(
  '/login',
  authLimiter,
  validateRequest(AffiliateValidation.loginAffiliateSchema),
  AffiliateController.login
);

router.post('/logout', AffiliateController.logout);

// ─────────────────────────────────────────────────────────────────────────────
// Protected Affiliate Partner Routes (`role: 'affiliate_partner'`)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/me',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getMe
);

router.get(
  '/overview',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getOverview
);

router.get(
  '/referrals',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getReferrals
);

router.get(
  '/referrals/:id',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getReferralById
);

router.get(
  '/commissions',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getCommissions
);

router.get(
  '/ledger',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getLedger
);

router.get(
  '/withdrawals',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getWithdrawals
);

router.post(
  '/withdrawals',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: false }),
  affiliateWithdrawalLimiter,
  validateRequest(AffiliateValidation.requestWithdrawalSchema),
  AffiliateController.requestWithdrawal
);

router.patch(
  '/profile',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: false }),
  affiliateProfileLimiter,
  validateRequest(AffiliateValidation.updateProfileSchema),
  AffiliateController.updateProfile
);

router.patch(
  '/change-password',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: false }),
  affiliateProfileLimiter,
  validateRequest(AffiliateValidation.changePasswordSchema),
  AffiliateController.changePassword
);

router.get(
  '/payment-methods',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getPaymentMethods
);

router.put(
  '/payment-methods',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: false }),
  affiliateProfileLimiter,
  validateRequest(AffiliateValidation.updatePaymentMethodsSchema),
  AffiliateController.updatePaymentMethods
);

// Affiliate Partner Support Ticket Routes
router.get(
  '/support',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getSupportTickets
);

router.post(
  '/support',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.createSupportTicket
);

router.get(
  '/support/:id',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.getSupportTicketDetail
);

router.post(
  '/support/:id/reply',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.replySupportTicket
);

router.patch(
  '/support/:id/status',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  AffiliateController.updateSupportTicketStatus
);

// ─────────────────────────────────────────────────────────────────────────────
// Protected Super Admin Routes (`role: 'super_admin'`)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/admin/overview',
  authMiddleware('super_admin'),
  AffiliateController.getAdminOverview
);

router.get(
  '/admin/list',
  authMiddleware('super_admin'),
  AffiliateController.getAdminAffiliatesList
);

router.get(
  '/admin/commissions/list',
  authMiddleware('super_admin'),
  AffiliateController.getAdminCommissionsList
);

router.patch(
  '/admin/commissions/:commissionId/status',
  authMiddleware('super_admin'),
  validateRequest(AffiliateValidation.adminCommissionActionSchema),
  AffiliateController.updateCommissionStatus
);

router.get(
  '/admin/withdrawals/list',
  authMiddleware('super_admin'),
  AffiliateController.getAdminWithdrawalsList
);

router.patch(
  '/admin/withdrawals/:withdrawalId/process',
  authMiddleware('super_admin'),
  validateRequest(AffiliateValidation.adminProcessWithdrawalSchema),
  AffiliateController.processAffiliateWithdrawal
);

router.get(
  '/admin/audit-logs',
  authMiddleware('super_admin'),
  AffiliateController.getAdminAuditLogs
);

router.get(
  '/admin/:id',
  authMiddleware('super_admin'),
  AffiliateController.getAdminAffiliateDetail
);

router.patch(
  '/admin/:id/status',
  authMiddleware('super_admin'),
  validateRequest(AffiliateValidation.adminUpdateStatusSchema),
  AffiliateController.updateAffiliateStatus
);

export const AffiliateRoutes = router;

