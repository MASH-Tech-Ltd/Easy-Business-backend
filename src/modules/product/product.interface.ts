import { Document, Types } from 'mongoose';

export interface IProduct extends Document {
  title: string;
  slug: string;
  shortDescription?: string;
  description?: string;
  images: {
    public_id: string;
    secure_url: string;
  }[];
  specifications?: {
    group: string;
    entries: {
      name: string;
      value: string;
    }[];
  }[];
  originalPrice: number;
  discountedPrice: number;
  saveAmount: number;
  badgeText?: string;
  features?: string[];
  videos?: string[];
  isAuthentic?: boolean;
  brand?: string;
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  condition?: string;
  status?: string;
  sku?: string;
  unit?: string;
  categoryId: Types.ObjectId;
  tenantId: Types.ObjectId;
  stock?: number;
  salesCount?: number;
}

export const ALLOWED_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'title',
  'discountedPrice',
  'originalPrice',
  'stock',
  'salesCount'
];
