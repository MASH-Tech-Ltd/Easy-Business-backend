import { Document, Types } from 'mongoose';

export interface ICheckoutLeadItem {
  productId?: string | undefined;
  title: string;
  price?: number | undefined;
  quantity: number;
  image?: string | undefined;
  color?: string | undefined;
  size?: string | undefined;
}

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
  items?: ICheckoutLeadItem[];
  subTotal?: number;
  status: 'abandoned' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}
