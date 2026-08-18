import { Document, Types } from 'mongoose';

export interface IOrderItem {
  productId: Types.ObjectId | string;
  title: string;
  price: number;
  quantity: number;
  image: string;
}

export interface IOrder extends Document {
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  note?: string;
  items: IOrderItem[];
  tenantId: Types.ObjectId;
  totalPrice: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}
