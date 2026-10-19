import { Schema, model } from 'mongoose';
import { ISubscription } from './subscription.interface';

const subscriptionSchema = new Schema<ISubscription>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    packageId: { type: Schema.Types.ObjectId, ref: 'Package', required: false, default: null },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ['active', 'expired', 'cancelled', 'pending'], default: 'active' },
    activationType: { type: String, enum: ['immediate', 'queue'], default: 'immediate' },
    isTrial: { type: Boolean, default: false },
    bonusAddonsGranted: { type: Boolean, default: false },
    originalPrice: { type: Number, default: null },
    paidAmount: { type: Number, default: null },
    discountApplied: { type: Schema.Types.Mixed, default: null },
    purchasedAddons: [
      {
        addonId: { type: Schema.Types.ObjectId, ref: 'Addon' },
        limit: { type: Number, default: 0 },
        used: { type: Number, default: 0 },
        isActive: { type: Boolean, default: false },
        status: { type: String, enum: ['pending', 'active', 'rejected', 'inactive', 'terminated'], default: 'pending' },
        requestedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.index({ tenantId: 1, status: 1, endDate: -1 });

export const Subscription = model<ISubscription>('Subscription', subscriptionSchema);
