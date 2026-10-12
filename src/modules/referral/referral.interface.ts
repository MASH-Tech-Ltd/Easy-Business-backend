import { Types } from 'mongoose';

export interface IReferral {
  _id?: Types.ObjectId;
  code: string;
  offerType?: 'trial_extension' | 'subscription_discount' | 'both'; // type of offer
  extraDays: number;
  discountType?: 'percentage' | 'fixed';                             // percentage or fixed BDT
  discountValue?: number;                                            // e.g. 10 (%) or 500 (BDT)
  description?: string;
  referrerName?: string;
  referrerUserId?: Types.ObjectId;
  referrerTenantId?: Types.ObjectId;
  isMerchantCode?: boolean;          // true if created for a specific merchant store
  pointsPerReferral?: number;        // points given to referrer when subscription is purchased (default: 20)
  maxUses?: number | null;
  usedCount: number;
  isActive: boolean;
  expiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IReferralUsage {
  _id?: Types.ObjectId;
  referralId: Types.ObjectId;
  referralCode: string;
  referrerUserId?: Types.ObjectId;
  referrerTenantId?: Types.ObjectId;
  referredUserId: Types.ObjectId;
  referredTenantId: Types.ObjectId;
  referredEmail: string;
  referredStoreName: string;
  extraDaysAwarded: number;
  pointsAwarded: number;             // e.g. 20 points
  pointsStatus: 'pending' | 'usable'; // 'pending' until referred merchant buys subscription, then becomes 'usable'
  activatedAt?: Date;                // when referred merchant purchased subscription
  createdAt?: Date;
}

export interface IReferralReward {
  _id?: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  totalPoints: number;              // total lifetime points earned
  pendingPoints: number;            // points waiting for referred merchant to buy subscription
  usablePoints: number;             // points ready to convert/withdraw (1 point = 1 Taka)
  withdrawnPoints: number;          // points already converted/withdrawn
  totalTakaWithdrawn: number;       // total BDT withdrawn
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IReferralWithdrawal {
  _id?: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  points: number;                   // points to convert
  takaAmount: number;               // 1 point = 1 BDT
  paymentMethod: 'bKash' | 'Nagad' | 'Rocket' | 'Bank';
  accountNumber: string;
  accountDetails?: string;
  status: 'pending' | 'approved' | 'rejected';
  adminFeedback?: string;
  processedAt?: Date;
  createdAt?: Date;
}
