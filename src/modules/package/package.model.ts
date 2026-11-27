import { Schema, model } from 'mongoose';
import { IPackage } from './package.interface';

const packageSchema = new Schema<IPackage>(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    productLimit: { type: Number, required: true },
    freeCourierLimit: { type: Number, default: 0 },
    freeAbandonedLimit: { type: Number, default: 0 },
    features: [{ type: String }],
    tagline: { type: String },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    isPopular: { type: Boolean, default: false },
    isRecommended: { type: Boolean, default: false },
    // Resource allocation (bytes). null/undefined = inherit global default; 0 = unlimited.
    resources: {
      storageBytes: { type: Number, default: null, min: 0 },
      imageBandwidthBytes: { type: Number, default: null, min: 0 },
      generalBandwidthBytes: { type: Number, default: null, min: 0 },
      combinedBandwidthBytes: { type: Number, default: null, min: 0 },
      trackingEnabled: { type: Boolean, default: true },
      overLimitPolicy: { type: String, default: null },
    },
  },
  {
    timestamps: true,
  }
);

packageSchema.index({ name: 1, billingCycle: 1 }, { unique: true });

export const Package = model<IPackage>('Package', packageSchema);
