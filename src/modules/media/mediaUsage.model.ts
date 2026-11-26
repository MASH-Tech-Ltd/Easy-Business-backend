import { Schema, model, Document, Types } from 'mongoose';
import { MediaProviderName } from './media.interface';

export interface IMediaUsage extends Document {
  /** null represents platform-wide (super admin / blog) uploads. */
  tenantId: Types.ObjectId | null;
  /** YYYY-MM in UTC */
  month: string;
  provider: MediaProviderName;
  uploadCount: number;
  uploadBytes: number;
  deleteCount: number;
  deletedBytes: number;
  /** Measured by Cloudflare GraphQL Analytics when configured; null when unavailable. */
  deliveryRequests: number | null;
  deliveryBytes: number | null;
  deliverySource: 'none' | 'cloudflare_graphql';
  deliveryUpdatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const mediaUsageSchema = new Schema<IMediaUsage>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    month: { type: String, required: true },
    provider: { type: String, enum: ['cloudinary', 'r2'], required: true },
    uploadCount: { type: Number, default: 0 },
    uploadBytes: { type: Number, default: 0 },
    deleteCount: { type: Number, default: 0 },
    deletedBytes: { type: Number, default: 0 },
    deliveryRequests: { type: Number, default: null },
    deliveryBytes: { type: Number, default: null },
    deliverySource: {
      type: String,
      enum: ['none', 'cloudflare_graphql'],
      default: 'none',
    },
    deliveryUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mediaUsageSchema.index({ tenantId: 1, month: 1, provider: 1 }, { unique: true });
mediaUsageSchema.index({ month: 1, provider: 1 });

export const MediaUsage = model<IMediaUsage>('MediaUsage', mediaUsageSchema);
