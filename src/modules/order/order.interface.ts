import { Document, Types } from 'mongoose';

export interface IOrderItem {
  productId: Types.ObjectId | string;
  title: string;
  price: number;
  quantity: number;
  image: string;
}

export interface IOrder extends Document {
  orderId: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  note?: string;
  items: IOrderItem[];
  tenantId: Types.ObjectId;
  subTotal: number;
  shippingCharge: number;
  totalPrice: number;
  isDeliveryChargePaid?: boolean;
  paymentStatus: 'unpaid' | 'paid';
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}
