import { Document, Types } from 'mongoose';

export interface ISubscription extends Document {
  tenantId: Types.ObjectId | string;
  packageId: Types.ObjectId | string;
  startDate: Date;
  endDate: Date;
  status: 'pending' | 'active' | 'expired' | 'cancelled';
  isTrial?: boolean;
  purchasedAddons?: {
    _id?: Types.ObjectId;
    addonId: Types.ObjectId | string;
    limit: number;
    used: number;
    isActive: boolean;
    status?: 'pending' | 'active' | 'rejected';
  }[];
  createdAt?: Date;
  updatedAt?: Date;
}
