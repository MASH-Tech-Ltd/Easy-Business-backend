import { Document, Types } from 'mongoose';

export type TOrderSourceType = 'storefront' | 'manual';

export type TOrderSource =
  | 'Website'
  | 'Facebook'
  | 'Messenger'
  | 'WhatsApp'
  | 'Phone Call'
  | 'Instagram'
  | 'Walk-in'
  | 'Other';

export interface IOrderItem {
  productId: Types.ObjectId | string;
  variantId?: Types.ObjectId | string;
  color?: string;
  size?: string;
  title: string;
  price: number;
  quantity: number;
  image: string;
}

export interface IOrder extends Document {
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  shippingAddress: string;
  note?: string;
  items: IOrderItem[];
  tenantId: Types.ObjectId;
  subTotal: number;
  discount?: number;
  shippingCharge: number;
  totalPrice: number;
  isDeliveryChargePaid?: boolean;
  paymentStatus: 'unpaid' | 'paid' | 'failed' | 'refunded';
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'returned';
  orderSourceType?: TOrderSourceType;
  orderSource?: TOrderSource | string;
  createdBy?: Types.ObjectId | string;
  courierProvider?: string;
  consignmentId?: string;
  trackingUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}
