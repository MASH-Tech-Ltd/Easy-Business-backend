import { Schema, model } from 'mongoose';
import { ICheckoutLead } from './checkoutLead.interface';

const checkoutLeadItemSchema = new Schema(
  {
    productId: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    price: { type: Number, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    image: { type: String, trim: true },
    color: { type: String, trim: true },
    size: { type: String, trim: true },
  },
  { _id: false }
);

const checkoutLeadSchema = new Schema<ICheckoutLead>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    email: { type: String, trim: true },
    phone: { type: String, trim: true, index: true },
    address: { type: String, trim: true },
    division: { type: String, trim: true },
    district: { type: String, trim: true },
    upazila: { type: String, trim: true },
    items: { type: [checkoutLeadItemSchema], default: [] },
    subTotal: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ['abandoned', 'completed'], default: 'abandoned', index: true },
  },
  {
    timestamps: true,
  }
);

export const CheckoutLead = model<ICheckoutLead>('CheckoutLead', checkoutLeadSchema);
