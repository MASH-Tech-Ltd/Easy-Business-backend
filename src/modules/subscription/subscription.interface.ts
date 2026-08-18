import { Document, Types } from 'mongoose';

export interface ISubscription extends Document {
  tenantId: Types.ObjectId | string;
  packageId: Types.ObjectId | string;
  startDate: Date;
  endDate: Date;
  status: 'pending' | 'active' | 'expired' | 'cancelled';
  createdAt?: Date;
  updatedAt?: Date;
}
