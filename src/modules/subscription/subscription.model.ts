import { Schema, model } from 'mongoose';
import { ISubscription } from './subscription.interface';

const subscriptionSchema = new Schema<ISubscription>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    packageId: { type: Schema.Types.ObjectId, ref: 'Package', required: false, default: null },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ['active', 'expired', 'cancelled', 'pending'], default: 'active' },
    isTrial: { type: Boolean, default: false },
    purchasedAddons: [
      {
        addonId: { type: Schema.Types.ObjectId, ref: 'Addon' },
        limit: { type: Number, default: 0 },
        used: { type: Number, default: 0 },
        isActive: { type: Boolean, default: false },
        status: { type: String, enum: ['pending', 'active', 'rejected'], default: 'pending' },
      },
    ],
  },
  {
    timestamps: true,
  }
);

export const Subscription = model<ISubscription>('Subscription', subscriptionSchema);
