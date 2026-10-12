import { Schema, model } from 'mongoose';
import { IReferral, IReferralUsage, IReferralReward, IReferralWithdrawal } from './referral.interface';

const referralSchema = new Schema<IReferral>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    offerType: {
      type: String,
      enum: ['trial_extension', 'subscription_discount', 'both'],
      default: 'trial_extension',
    },
    extraDays: {
      type: Number,
      required: true,
      default: 10,
      min: 0,
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage',
    },
    discountValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    referrerName: {
      type: String,
      trim: true,
      default: '',
    },
    referrerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    referrerTenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
    },
    isMerchantCode: {
      type: Boolean,
      default: false,
    },
    pointsPerReferral: {
      type: Number,
      default: 20,
    },
    maxUses: {
      type: Number,
      default: null,
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

referralSchema.index(
  { referrerTenantId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { isMerchantCode: true, referrerTenantId: { $type: 'objectId' } },
  }
);

const referralUsageSchema = new Schema<IReferralUsage>(
  {
    referralId: {
      type: Schema.Types.ObjectId,
      ref: 'Referral',
      required: true,
      index: true,
    },
    referralCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    referrerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    referrerTenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    referredUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    referredTenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    referredEmail: {
      type: String,
      trim: true,
      default: '',
    },
    referredStoreName: {
      type: String,
      trim: true,
      default: '',
    },
    extraDaysAwarded: {
      type: Number,
      default: 10,
    },
    pointsAwarded: {
      type: Number,
      default: 20,
    },
    pointsStatus: {
      type: String,
      enum: ['pending', 'usable'],
      default: 'pending',
      index: true,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

const referralRewardSchema = new Schema<IReferralReward>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    totalPoints: {
      type: Number,
      default: 0,
    },
    pendingPoints: {
      type: Number,
      default: 0,
    },
    usablePoints: {
      type: Number,
      default: 0,
    },
    withdrawnPoints: {
      type: Number,
      default: 0,
    },
    totalTakaWithdrawn: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const referralWithdrawalSchema = new Schema<IReferralWithdrawal>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    points: {
      type: Number,
      required: true,
      min: 20,
    },
    takaAmount: {
      type: Number,
      required: true,
      min: 20,
    },
    paymentMethod: {
      type: String,
      enum: ['bKash', 'Nagad', 'Rocket', 'Bank'],
      required: true,
    },
    accountNumber: {
      type: String,
      required: true,
      trim: true,
    },
    accountDetails: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    adminFeedback: {
      type: String,
      default: '',
    },
    processedAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

export const Referral = model<IReferral>('Referral', referralSchema);
export const ReferralUsage = model<IReferralUsage>('ReferralUsage', referralUsageSchema);
export const ReferralReward = model<IReferralReward>('ReferralReward', referralRewardSchema);
export const ReferralWithdrawal = model<IReferralWithdrawal>('ReferralWithdrawal', referralWithdrawalSchema);
