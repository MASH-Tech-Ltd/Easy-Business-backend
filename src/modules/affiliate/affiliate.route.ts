import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { AffiliateController } from './affiliate.controller';
import { AffiliateValidation } from './affiliate.validation';
import {
  requireAffiliatePartner,
  affiliatePublicConfigLimiter,
  affiliateCodeValidationLimiter,
  affiliateTrackClickLimiter,
  affiliateAuthLimiter,
  affiliateRefreshTokenLimiter,
  affiliateWithdrawalLimiter,
  affiliateProfileLimiter,
  affiliatePasswordChangeLimiter,
  affiliatePaymentMethodsLimiter,
  affiliateSupportCreateLimiter,
  affiliateSupportReplyLimiter,
  affiliateQueryLimiter,
  affiliateAdminActionLimiter,
  affiliateAdminFinancialLimiter,
} from './affiliate.middleware';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Public & Authentication Routes
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/public-config',
  affiliatePublicConfigLimiter,
  AffiliateController.getPublicConfig
);

router.get(
  '/validate-code/:code',
  affiliateCodeValidationLimiter,
  AffiliateController.validateCode
);

router.post(
  '/track-click',
  affiliateTrackClickLimiter,
  AffiliateController.trackClick
);

router.post(
  '/register',
  affiliateAuthLimiter,
  validateRequest(AffiliateValidation.registerAffiliateSchema),
  AffiliateController.register
);

router.post(
  '/login',
  affiliateAuthLimiter,
  validateRequest(AffiliateValidation.loginAffiliateSchema),
  AffiliateController.login
);

router.post(
  '/refresh-token',
  affiliateRefreshTokenLimiter,
  AffiliateController.refreshToken
);

router.post(
  '/logout',
  affiliateAuthLimiter,
  AffiliateController.logout
);

// ─────────────────────────────────────────────────────────────────────────────
// Protected Affiliate Partner Routes (`role: 'affiliate_partner'`)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/me',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
  AffiliateController.getMe
);

router.get(
  '/overview',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
  AffiliateController.getOverview
);

router.get(
  '/referrals',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
  AffiliateController.getReferrals
);

router.get(
  '/referrals/:id',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
  AffiliateController.getReferralById
);

router.get(
  '/commissions',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
  AffiliateController.getCommissions
);

router.get(
  '/ledger',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
  AffiliateController.getLedger
);

router.get(
  '/withdrawals',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
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
  affiliatePasswordChangeLimiter,
  validateRequest(AffiliateValidation.changePasswordSchema),
  AffiliateController.changePassword
);

router.get(
  '/payment-methods',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
  AffiliateController.getPaymentMethods
);

router.put(
  '/payment-methods',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: false }),
  affiliatePaymentMethodsLimiter,
  validateRequest(AffiliateValidation.updatePaymentMethodsSchema),
  AffiliateController.updatePaymentMethods
);

// ─────────────────────────────────────────────────────────────────────────────
// Affiliate Partner Support Ticket Routes
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/support',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
  AffiliateController.getSupportTickets
);

router.post(
  '/support',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateSupportCreateLimiter,
  AffiliateController.createSupportTicket
);

router.get(
  '/support/:id',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateQueryLimiter,
  AffiliateController.getSupportTicketDetail
);

router.post(
  '/support/:id/reply',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateSupportReplyLimiter,
  AffiliateController.replySupportTicket
);

router.patch(
  '/support/:id/status',
  authMiddleware('affiliate_partner'),
  requireAffiliatePartner({ allowReadOnlyWhenSuspended: true }),
  affiliateSupportReplyLimiter,
  AffiliateController.updateSupportTicketStatus
);

// ─────────────────────────────────────────────────────────────────────────────
// Protected Super Admin Routes (`role: 'super_admin'`)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/admin/overview',
  authMiddleware('super_admin'),
  affiliateQueryLimiter,
  AffiliateController.getAdminOverview
);

router.get(
  '/admin/list',
  authMiddleware('super_admin'),
  affiliateQueryLimiter,
  AffiliateController.getAdminAffiliatesList
);

router.get(
  '/admin/commissions/list',
  authMiddleware('super_admin'),
  affiliateQueryLimiter,
  AffiliateController.getAdminCommissionsList
);

router.patch(
  '/admin/commissions/:commissionId/status',
  authMiddleware('super_admin'),
  affiliateAdminActionLimiter,
  validateRequest(AffiliateValidation.adminCommissionActionSchema),
  AffiliateController.updateCommissionStatus
);

router.get(
  '/admin/withdrawals/list',
  authMiddleware('super_admin'),
  affiliateQueryLimiter,
  AffiliateController.getAdminWithdrawalsList
);

router.patch(
  '/admin/withdrawals/:withdrawalId/process',
  authMiddleware('super_admin'),
  affiliateAdminFinancialLimiter,
  validateRequest(AffiliateValidation.adminProcessWithdrawalSchema),
  AffiliateController.processAffiliateWithdrawal
);

router.get(
  '/admin/audit-logs',
  authMiddleware('super_admin'),
  affiliateQueryLimiter,
  AffiliateController.getAdminAuditLogs
);

router.get(
  '/admin/:id',
  authMiddleware('super_admin'),
  affiliateQueryLimiter,
  AffiliateController.getAdminAffiliateDetail
);

router.patch(
  '/admin/:id/status',
  authMiddleware('super_admin'),
  affiliateAdminActionLimiter,
  validateRequest(AffiliateValidation.adminUpdateStatusSchema),
  AffiliateController.updateAffiliateStatus
);

export const AffiliateRoutes = router;
