import { Document, Types } from 'mongoose';

export interface IFraudCheck extends Document {
  orderId: Types.ObjectId;
  tenantId: Types.ObjectId;
  customerPhone: string;
  customerName: string;
  status: 'safe' | 'suspicious' | 'fraud';
  score: number;
  details?: string;
  checkedAt: Date;
}
