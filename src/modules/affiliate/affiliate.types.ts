import { Document, Types } from 'mongoose';
import {
  AffiliateStatus,
  CommissionStatus,
  WithdrawalStatus,
  ReferralEligibilityStatus,
} from './affiliate.constants';

export interface IAffiliatePaymentMethod {
  id: string;
  method: 'bKash' | 'Nagad' | 'Rocket' | 'Bank';
  accountType?: string | undefined; // Personal / Agent / Savings / Current
  accountNumber: string;
  accountName: string;
  bankName?: string | undefined;
  branchName?: string | undefined;
  routingNumber?: string | undefined;
  isDefault: boolean;
}

export interface ICommissionSnapshot {
  commissionRate: number;
  durationMonths: number;
  commissionType: 'recurring' | 'one_time';
  approvalMode: 'auto' | 'manual';
  holdDays: number;
}

export interface IAffiliate extends Document {
  userId: Types.ObjectId;
  affiliateCode: string;
  status: AffiliateStatus;
  commissionConfigOverride?: {
    commissionRate?: number | undefined;
    durationMonths?: number | undefined;
    commissionType?: 'recurring' | 'one_time' | undefined;
  } | undefined;
  totalClicks: number;
  totalReferrals: number;
  activeReferrals: number;
  subscribedReferrals: number;
  totalEarnings: number;
  availableBalance: number;
  pendingBalance: number;
  reservedBalance: number;
  totalWithdrawn: number;
  paymentMethods: IAffiliatePaymentMethod[];
  referredByAffiliateId?: Types.ObjectId | null | undefined;
  suspensionReason?: string | undefined;
  approvedAt?: Date | null | undefined;
  approvedBy?: Types.ObjectId | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAffiliateReferral extends Document {
  affiliateId: Types.ObjectId;
  affiliateUserId: Types.ObjectId;
  referredMerchantUserId: Types.ObjectId;
  referredTenantId: Types.ObjectId;
  referredStoreName: string;
  referredEmail: string;
  referralCodeUsed: string;
  registeredAt: Date;
  attributedAt: Date;
  subscriptionStatus: 'trial' | 'active' | 'expired' | 'cancelled';
  eligibilityStatus: ReferralEligibilityStatus;
  eligibilityStartDate?: Date | null | undefined;
  eligibilityEndDate?: Date | null | undefined;
  commissionSnapshot: ICommissionSnapshot;
  totalPaidAmount: number;
  totalCommissionEarned: number;
  paymentsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAffiliateCommission extends Document {
  affiliateId: Types.ObjectId;
  affiliateUserId: Types.ObjectId;
  referralId: Types.ObjectId;
  referredTenantId: Types.ObjectId;
  referredMerchantName: string;
  referredStoreName: string;
  subscriptionId: Types.ObjectId;
  paymentSubmissionId?: Types.ObjectId | null | undefined;
  idempotencyKey: string;
  paymentDescription: string;
  originalPackagePrice: number;
  actualAmountPaid: number;
  commissionRate: number;
  commissionAmount: number;
  currency: string;
  eligibilityPeriodStart: Date;
  eligibilityPeriodEnd: Date;
  status: CommissionStatus;
  approvedAt?: Date | null | undefined;
  settledAt?: Date | null | undefined;
  reversedAt?: Date | null | undefined;
  reversalReason?: string | undefined;
  reversalReferenceId?: string | undefined;
  adminActorId?: Types.ObjectId | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAffiliateWithdrawal extends Document {
  affiliateId: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  currency: string;
  paymentMethod: 'bKash' | 'Nagad' | 'Rocket' | 'Bank';
  paymentDetails: {
    accountNumber: string;
    accountName: string;
    accountType?: string | undefined;
    bankName?: string | undefined;
    branchName?: string | undefined;
    routingNumber?: string | undefined;
  };
  status: WithdrawalStatus;
  transactionReference: string;
  rejectionReason: string;
  adminNotes: string;
  adminActorId?: Types.ObjectId | null | undefined;
  requestedAt: Date;
  processingAt?: Date | null | undefined;
  completedAt?: Date | null | undefined;
  rejectedAt?: Date | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAffiliateLedger extends Document {
  affiliateId: Types.ObjectId;
  type:
    | 'commission_generated'
    | 'commission_approved'
    | 'commission_available'
    | 'commission_reversed'
    | 'withdrawal_requested'
    | 'withdrawal_completed'
    | 'withdrawal_rejected'
    | 'admin_adjustment';
  direction: 'credit' | 'debit' | 'reserve' | 'release';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  pendingBefore: number;
  pendingAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  referenceType: 'commission' | 'withdrawal' | 'admin';
  referenceId?: Types.ObjectId | null | undefined;
  description: string;
  actorId?: Types.ObjectId | null | undefined;
  createdAt: Date;
}

export interface IAffiliateAuditLog extends Document {
  actorId?: Types.ObjectId | null | undefined;
  actorRole: string;
  action: string;
  targetType: 'affiliate' | 'commission' | 'withdrawal' | 'settings' | 'referral';
  targetId: string;
  reason?: string | undefined;
  metadata?: Record<string, any> | undefined;
  ipAddress?: string | undefined;
  createdAt: Date;
}

