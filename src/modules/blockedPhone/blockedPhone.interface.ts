import { Document, Types } from 'mongoose';

export interface IBlockedPhone extends Document {
  tenantId: Types.ObjectId | string;
  phone: string;
  normalizedPhone: string;
  customerName?: string;
  reason?: string;
  blockedBy?: Types.ObjectId | string;
  createdAt: Date;
  updatedAt: Date;
}

