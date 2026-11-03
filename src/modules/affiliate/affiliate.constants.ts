export const AFFILIATE_ROLE = 'affiliate_partner' as const;

export const AFFILIATE_DEFAULT_SETTINGS = {
  programEnabled: true,
  allowAffiliateRegistration: true,
  maxAffiliates: 500,
  approvalMode: 'auto' as 'auto' | 'manual',
  referralCodePrefix: 'MASH',
  extraTrialDaysForReferredMerchant: 10,
  termsAndConditions:
    'Affiliate partners earn 30% recurring commission for 6 months on actual subscription payments made by referred merchants. Minimum withdrawal is ৳100.',
  defaultCommissionRate: 30,
  commissionDurationMonths: 6,
  commissionType: 'recurring' as 'recurring' | 'one_time',
  commissionBasis: 'actual_paid' as const,
  commissionApprovalMode: 'auto' as 'auto' | 'manual',
  holdDays: 0,
  autoReverseOnRefund: true,
  withdrawalsEnabled: true,
  minimumWithdrawalAmount: 100,
  maximumWithdrawalAmount: 50000,
  supportedMethods: ['bKash', 'Nagad', 'Rocket', 'Bank'],
  withdrawalApprovalRequired: true,
  notifications: {
    onRegistration: true,
    onCommissionGenerated: true,
    onCommissionApproved: true,
    onWithdrawalRequested: true,
    onWithdrawalCompleted: true,
    onWithdrawalRejected: true,
  },
};

export const AFFILIATE_STATUSES = ['active', 'pending', 'suspended', 'deactivated'] as const;
export type AffiliateStatus = (typeof AFFILIATE_STATUSES)[number];

export const COMMISSION_STATUSES = [
  'pending',
  'approved',
  'available',
  'paid',
  'rejected',
  'reversed',
  'expired',
] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const WITHDRAWAL_STATUSES = ['pending', 'processing', 'completed', 'rejected'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const REFERRAL_ELIGIBILITY_STATUSES = [
  'pending_first_payment',
  'active',
  'expired',
  'revoked',
] as const;
export type ReferralEligibilityStatus = (typeof REFERRAL_ELIGIBILITY_STATUSES)[number];

export const AFFILIATE_SOCKET_EVENTS = {
  // Affiliate-facing events
  REFERRAL_CREATED: 'affiliate:referral:created',
  REFERRAL_SUBSCRIBED: 'affiliate:referral:subscribed',
  COMMISSION_CREATED: 'affiliate:commission:created',
  COMMISSION_APPROVED: 'affiliate:commission:approved',
  COMMISSION_REVERSED: 'affiliate:commission:reversed',
  BALANCE_UPDATED: 'affiliate:balance:updated',
  WITHDRAWAL_REQUESTED: 'affiliate:withdrawal:requested',
  WITHDRAWAL_PROCESSING: 'affiliate:withdrawal:processing',
  WITHDRAWAL_COMPLETED: 'affiliate:withdrawal:completed',
  WITHDRAWAL_REJECTED: 'affiliate:withdrawal:rejected',
  ACCOUNT_STATUS_CHANGED: 'affiliate:account:status-changed',

  // Admin-facing events
  ADMIN_AFFILIATE_REGISTERED: 'admin:affiliate:registered',
  ADMIN_WITHDRAWAL_REQUESTED: 'admin:affiliate:withdrawal-requested',
  ADMIN_COMMISSION_GENERATED: 'admin:affiliate:commission-generated',
  ADMIN_STATS_UPDATED: 'admin:affiliate:stats-updated',
} as const;

