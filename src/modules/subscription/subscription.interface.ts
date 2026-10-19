import { Document, Types } from 'mongoose';

export interface ISubscription extends Document {
  tenantId: Types.ObjectId | string;
  packageId: Types.ObjectId | string;
  startDate: Date;
  endDate: Date;
  status: 'pending' | 'active' | 'expired' | 'cancelled';
  activationType?: 'immediate' | 'queue';
  isTrial?: boolean;
  bonusAddonsGranted?: boolean;
  originalPrice?: number;
  paidAmount?: number;
  discountApplied?: {
    discountType?: 'percentage' | 'fixed';
    discountValue?: number;
    discountAmount?: number;
    reason?: string;
  };
  purchasedAddons?: {
    _id?: Types.ObjectId;
    addonId: Types.ObjectId | string;
    limit: number;
    used: number;
    isActive: boolean;
    status?: 'pending' | 'active' | 'rejected' | 'inactive' | 'terminated';
    requestedAt?: Date;
  }[];
  createdAt?: Date;
  updatedAt?: Date;
}
