import { Document, Types } from 'mongoose';

export interface IUser extends Document {
  email: string;
  password?: string; // Optional for OAuth
  role: 'super_admin' | 'tenant_admin' | 'customer';
  tenantId?: Types.ObjectId; // Only for tenant_admin and customer
  name: string;
  phone?: string;
  address?: string;
  details?: string;
  avatar?: {
    public_id: string;
    secure_url: string;
  };
}
