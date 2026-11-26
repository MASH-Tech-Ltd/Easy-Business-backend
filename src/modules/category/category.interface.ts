import { Document, Types } from 'mongoose';

export interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;
  image?: {
    public_id: string;
    secure_url: string;
    provider?: 'cloudinary' | 'r2';
  };
  status?: string;
  tenantId: Types.ObjectId;
}
