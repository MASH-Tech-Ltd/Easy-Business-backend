import { Schema, model } from 'mongoose';
import { IBlockedPhone } from './blockedPhone.interface';

const blockedPhoneSchema = new Schema<IBlockedPhone>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    phone: { type: String, required: true, trim: true },
    normalizedPhone: { type: String, required: true, trim: true },
    customerName: { type: String, trim: true, default: '' },
    reason: { type: String, trim: true, default: 'Blocked by merchant' },
    blockedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  }
);

// Strictly isolate blocked phone numbers per merchant/tenant
blockedPhoneSchema.index({ tenantId: 1, normalizedPhone: 1 }, { unique: true });

export const BlockedPhone = model<IBlockedPhone>('BlockedPhone', blockedPhoneSchema);

