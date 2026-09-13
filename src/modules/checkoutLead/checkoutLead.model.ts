import { Schema, model } from 'mongoose';
import { ICheckoutLead } from './checkoutLead.interface';

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
    status: { type: String, enum: ['abandoned', 'completed'], default: 'abandoned', index: true },
  },
  {
    timestamps: true,
  }
);

// Optional: Automatically expire abandoned checkouts after a certain time (e.g., 30 days) to keep DB clean
// checkoutLeadSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const CheckoutLead = model<ICheckoutLead>('CheckoutLead', checkoutLeadSchema);
