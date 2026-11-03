import { Request, Response, NextFunction } from 'express';
import { Affiliate } from './affiliate.model';
import { customRateLimit } from '../../middleware/rateLimiter';

/**
 * Ensures the authenticated user is an `affiliate_partner` with an existing Affiliate profile.
 * If `allowReadOnlyWhenSuspended` is true, GET requests are permitted for suspended affiliates so they can see their banner & status,
 * while all state-changing/withdrawal operations are blocked for non-active accounts.
 */
export const requireAffiliatePartner = (options: { allowReadOnlyWhenSuspended?: boolean } = {}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user || user.role !== 'affiliate_partner') {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_ROLE',
          message: 'Access restricted to Affiliate Partners.',
        });
      }

      const affiliate = await Affiliate.findOne({ userId: user._id });
      if (!affiliate) {
        return res.status(404).json({
          success: false,
          code: 'AFFILIATE_NOT_FOUND',
          message: 'Affiliate partner profile not found.',
        });
      }

      if (affiliate.status === 'deactivated') {
        return res.status(403).json({
          success: false,
          code: 'AFFILIATE_DEACTIVATED',
          message:
            'Your affiliate partner account has been deactivated. Please contact support for assistance.',
        });
      }

      const isReadOnlyMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (
        (affiliate.status === 'suspended' || affiliate.status === 'pending') &&
        !(options.allowReadOnlyWhenSuspended && isReadOnlyMethod)
      ) {
        return res.status(403).json({
          success: false,
          code: affiliate.status === 'suspended' ? 'AFFILIATE_SUSPENDED' : 'AFFILIATE_PENDING',
          message:
            affiliate.status === 'suspended'
              ? `Your affiliate account is suspended${affiliate.suspensionReason ? `: ${affiliate.suspensionReason}` : ''}. Write and withdrawal operations are disabled.`
              : 'Your affiliate account is pending administrator approval.',
        });
      }

      (req as any).affiliate = affiliate;
      return next();
    } catch (_error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to verify affiliate partner status.',
      });
    }
  };
};

// Rate limiters tailored for Affiliate endpoints
export const affiliatePublicConfigLimiter = customRateLimit(
  1 * 60 * 1000, // 1 minute
  120,
  'Too many public affiliate configuration requests. Please try again in a minute.'
);

export const affiliateCodeValidationLimiter = customRateLimit(
  1 * 60 * 1000, // 1 minute
  45,
  'Too many referral code validation attempts. Please slow down.'
);

export const affiliateTrackClickLimiter = customRateLimit(
  1 * 60 * 1000, // 1 minute
  90,
  'Too many referral click events. Please wait a minute.'
);

export const affiliateAuthLimiter = customRateLimit(
  15 * 60 * 1000, // 15 minutes
  15,
  'Too many affiliate login or registration attempts. Please wait 15 minutes before trying again.'
);

export const affiliateRefreshTokenLimiter = customRateLimit(
  1 * 60 * 1000, // 1 minute
  60,
  'Too many token refresh requests. Please slow down.'
);

export const affiliateWithdrawalLimiter = customRateLimit(
  10 * 60 * 1000, // 10 minutes
  8,
  'Too many withdrawal requests. Please wait 10 minutes before requesting again.'
);

export const affiliateProfileLimiter = customRateLimit(
  5 * 60 * 1000, // 5 minutes
  25,
  'Too many profile update requests. Please slow down.'
);

export const affiliatePasswordChangeLimiter = customRateLimit(
  15 * 60 * 1000, // 15 minutes
  6,
  'Too many password change attempts. Please wait 15 minutes before trying again.'
);

export const affiliatePaymentMethodsLimiter = customRateLimit(
  5 * 60 * 1000, // 5 minutes
  15,
  'Too many payment method update requests. Please wait 5 minutes before trying again.'
);

export const affiliateSupportCreateLimiter = customRateLimit(
  10 * 60 * 1000, // 10 minutes
  10,
  'Too many support tickets created. Please wait before creating another ticket.'
);

export const affiliateSupportReplyLimiter = customRateLimit(
  1 * 60 * 1000, // 1 minute
  30,
  'Too many support ticket replies. Please wait a moment.'
);

export const affiliateQueryLimiter = customRateLimit(
  1 * 60 * 1000, // 1 minute
  120,
  'Too many dashboard queries. Please slow down.'
);

export const affiliateAdminActionLimiter = customRateLimit(
  1 * 60 * 1000, // 1 minute
  40,
  'Too many admin affiliate actions. Please slow down.'
);

export const affiliateAdminFinancialLimiter = customRateLimit(
  1 * 60 * 1000, // 1 minute
  20,
  'Too many withdrawal processing requests. Please wait a moment.'
);

export const affiliatePublicClickLimiter = affiliateCodeValidationLimiter;

