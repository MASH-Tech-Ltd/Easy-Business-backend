import { Schema, model } from 'mongoose';
import { IPackage } from './package.interface';

const packageSchema = new Schema<IPackage>(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    productLimit: { type: Number, required: true },
    features: [{ type: String }],
    tagline: { type: String },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    isPopular: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

packageSchema.index({ name: 1, billingCycle: 1 }, { unique: true });

export const Package = model<IPackage>('Package', packageSchema);
