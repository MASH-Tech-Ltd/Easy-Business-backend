import { Document, Types } from 'mongoose';

export interface ICheckoutLead extends Document {
  tenantId: string | Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  division?: string;
  district?: string;
  upazila?: string;
  status: 'abandoned' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}
