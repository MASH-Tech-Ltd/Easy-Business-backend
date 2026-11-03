import mongoose, { Schema, model } from 'mongoose';
import {
  IAffiliate,
  IAffiliateReferral,
  IAffiliateCommission,
  IAffiliateWithdrawal,
  IAffiliateLedger,
  IAffiliateAuditLog,
} from './affiliate.types';
import {
  AFFILIATE_STATUSES,
  COMMISSION_STATUSES,
  WITHDRAWAL_STATUSES,
  REFERRAL_ELIGIBILITY_STATUSES,
} from './affiliate.constants';

// 1. Affiliate Profile Schema
const affiliatePaymentMethodSchema = new Schema(
  {
    id: { type: String, required: true },
    method: { type: String, enum: ['bKash', 'Nagad', 'Rocket', 'Bank'], required: true },
    accountType: { type: String, default: 'Personal' },
    accountNumber: { type: String, required: true, trim: true },
    accountName: { type: String, required: true, trim: true },
    bankName: { type: String, default: '' },
    branchName: { type: String, default: '' },
    routingNumber: { type: String, default: '' },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false }
);

const affiliateSchema = new Schema<IAffiliate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    affiliateCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: AFFILIATE_STATUSES,
      default: 'active',
      index: true,
    },
    commissionConfigOverride: {
      commissionRate: { type: Number },
      durationMonths: { type: Number },
      commissionType: { type: String, enum: ['recurring', 'one_time'] },
    },
    totalClicks: { type: Number, default: 0 },
    totalReferrals: { type: Number, default: 0 },
    activeReferrals: { type: Number, default: 0 },
    subscribedReferrals: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
    pendingBalance: { type: Number, default: 0 },
    reservedBalance: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    paymentMethods: { type: [affiliatePaymentMethodSchema], default: [] },
    referredByAffiliateId: { type: Schema.Types.ObjectId, ref: 'Affiliate', default: null },
    suspensionReason: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

affiliateSchema.index({ status: 1, createdAt: -1 });

// 2. Affiliate Referral Attribution Schema
const affiliateReferralSchema = new Schema<IAffiliateReferral>(
  {
    affiliateId: { type: Schema.Types.ObjectId, ref: 'Affiliate', required: true, index: true },
    affiliateUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referredMerchantUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referredTenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
      index: true,
    },
    referredStoreName: { type: String, required: true, trim: true },
    referredEmail: { type: String, required: true, trim: true },
    referralCodeUsed: { type: String, required: true, uppercase: true, trim: true, index: true },
    registeredAt: { type: Date, default: Date.now },
    attributedAt: { type: Date, default: Date.now },
    subscriptionStatus: {
      type: String,
      enum: ['trial', 'active', 'expired', 'cancelled'],
      default: 'trial',
      index: true,
    },
    eligibilityStatus: {
      type: String,
      enum: REFERRAL_ELIGIBILITY_STATUSES,
      default: 'pending_first_payment',
      index: true,
    },
    eligibilityStartDate: { type: Date, default: null },
    eligibilityEndDate: { type: Date, default: null },
    commissionSnapshot: {
      commissionRate: { type: Number, required: true, default: 30 },
      durationMonths: { type: Number, required: true, default: 6 },
      commissionType: {
        type: String,
        enum: ['recurring', 'one_time'],
        required: true,
        default: 'recurring',
      },
      approvalMode: {
        type: String,
        enum: ['auto', 'manual'],
        required: true,
        default: 'auto',
      },
      holdDays: { type: Number, default: 0 },
    },
    totalPaidAmount: { type: Number, default: 0 },
    totalCommissionEarned: { type: Number, default: 0 },
    paymentsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

affiliateReferralSchema.index({ affiliateId: 1, createdAt: -1 });
affiliateReferralSchema.index({ affiliateId: 1, eligibilityStatus: 1 });

// 3. Affiliate Commission Schema
const affiliateCommissionSchema = new Schema<IAffiliateCommission>(
  {
    affiliateId: { type: Schema.Types.ObjectId, ref: 'Affiliate', required: true, index: true },
    affiliateUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referralId: {
      type: Schema.Types.ObjectId,
      ref: 'AffiliateReferral',
      required: true,
      index: true,
    },
    referredTenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    referredMerchantName: { type: String, default: '' },
    referredStoreName: { type: String, default: '' },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true,
      index: true,
    },
    paymentSubmissionId: {
      type: Schema.Types.ObjectId,
      ref: 'PlatformPaymentSubmission',
      default: null,
    },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    paymentDescription: { type: String, required: true },
    originalPackagePrice: { type: Number, required: true },
    actualAmountPaid: { type: Number, required: true },
    commissionRate: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    currency: { type: String, default: 'BDT' },
    eligibilityPeriodStart: { type: Date, required: true },
    eligibilityPeriodEnd: { type: Date, required: true },
    status: {
      type: String,
      enum: COMMISSION_STATUSES,
      default: 'available',
      index: true,
    },
    approvedAt: { type: Date, default: null },
    settledAt: { type: Date, default: null },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, default: '' },
    reversalReferenceId: { type: String, default: '' },
    adminActorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

affiliateCommissionSchema.index({ affiliateId: 1, status: 1, createdAt: -1 });
affiliateCommissionSchema.index({ createdAt: -1 });

// 4. Affiliate Withdrawal Schema
const affiliateWithdrawalSchema = new Schema<IAffiliateWithdrawal>(
  {
    affiliateId: { type: Schema.Types.ObjectId, ref: 'Affiliate', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'BDT' },
    paymentMethod: {
      type: String,
      enum: ['bKash', 'Nagad', 'Rocket', 'Bank'],
      required: true,
    },
    paymentDetails: {
      accountNumber: { type: String, required: true, trim: true },
      accountName: { type: String, required: true, trim: true },
      accountType: { type: String, default: 'Personal' },
      bankName: { type: String, default: '' },
      branchName: { type: String, default: '' },
      routingNumber: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: WITHDRAWAL_STATUSES,
      default: 'pending',
      index: true,
    },
    transactionReference: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    adminNotes: { type: String, default: '' },
    adminActorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    requestedAt: { type: Date, default: Date.now },
    processingAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

affiliateWithdrawalSchema.index({ affiliateId: 1, status: 1, createdAt: -1 });
affiliateWithdrawalSchema.index({ status: 1, createdAt: -1 });

// 5. Immutable Financial Ledger Schema
const affiliateLedgerSchema = new Schema<IAffiliateLedger>(
  {
    affiliateId: { type: Schema.Types.ObjectId, ref: 'Affiliate', required: true, index: true },
    type: {
      type: String,
      enum: [
        'commission_generated',
        'commission_approved',
        'commission_available',
        'commission_reversed',
        'withdrawal_requested',
        'withdrawal_completed',
        'withdrawal_rejected',
        'admin_adjustment',
      ],
      required: true,
    },
    direction: {
      type: String,
      enum: ['credit', 'debit', 'reserve', 'release'],
      required: true,
    },
    amount: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    pendingBefore: { type: Number, required: true },
    pendingAfter: { type: Number, required: true },
    reservedBefore: { type: Number, required: true },
    reservedAfter: { type: Number, required: true },
    referenceType: {
      type: String,
      enum: ['commission', 'withdrawal', 'admin'],
      required: true,
    },
    referenceId: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

affiliateLedgerSchema.index({ affiliateId: 1, createdAt: -1 });

// 6. Affiliate Audit Log Schema
const affiliateAuditLogSchema = new Schema<IAffiliateAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, index: true },
    targetType: {
      type: String,
      enum: ['affiliate', 'commission', 'withdrawal', 'settings', 'referral'],
      required: true,
    },
    targetId: { type: String, required: true, index: true },
    reason: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, expires: 86400, index: true },
  },
  { timestamps: false }
);

// Auto-expire audit logs after 1 day (86,400 seconds) via MongoDB TTL index
affiliateAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export const Affiliate = model<IAffiliate>('Affiliate', affiliateSchema);
export const AffiliateReferral = model<IAffiliateReferral>(
  'AffiliateReferral',
  affiliateReferralSchema
);
export const AffiliateCommission = model<IAffiliateCommission>(
  'AffiliateCommission',
  affiliateCommissionSchema
);
export const AffiliateWithdrawal = model<IAffiliateWithdrawal>(
  'AffiliateWithdrawal',
  affiliateWithdrawalSchema
);
export const AffiliateLedger = model<IAffiliateLedger>(
  'AffiliateLedger',
  affiliateLedgerSchema
);
export const AffiliateAuditLog = model<IAffiliateAuditLog>(
  'AffiliateAuditLog',
  affiliateAuditLogSchema
);
