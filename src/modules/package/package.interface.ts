import { Document } from 'mongoose';

export interface IPackage extends Document {
  name: string;
  price: number;
  billingCycle: 'monthly' | 'yearly';
  productLimit: number;
  features?: string[];
  tagline?: string;
  description?: string;
  isActive: boolean;
  isPopular?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
