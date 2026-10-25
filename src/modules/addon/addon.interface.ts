import { Document } from 'mongoose';

export interface IAddon extends Document {
  name: string;
  slug: string;
  description: string;
  price: number;
  billingCycle: 'monthly' | 'yearly' | 'one_time';
  defaultLimit: number;
  isActive: boolean;
  applicablePlans?: string[];
  badge?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
