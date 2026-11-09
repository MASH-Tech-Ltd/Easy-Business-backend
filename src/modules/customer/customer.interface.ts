import { Document, Types } from 'mongoose';

export interface ICustomer extends Document {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  tenantId: Types.ObjectId;
  totalOrders: number;
  totalSpent: number;
}
