import { Schema, model } from 'mongoose';
import { IAddon } from './addon.interface';

const addonSchema = new Schema<IAddon>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    billingCycle: { type: String, enum: ['monthly', 'yearly', 'one_time'], required: true },
    defaultLimit: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const Addon = model<IAddon>('Addon', addonSchema);
