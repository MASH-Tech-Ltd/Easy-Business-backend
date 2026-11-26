import { Schema, model, Document, Types } from 'mongoose';
import { MediaKind, MediaProviderName } from './media.interface';

export interface IMediaAssetVariant {
  key: string;
  width: number;
  height: number;
  bytes: number;
}

export interface IMediaAsset extends Document {
  tenantId: Types.ObjectId | null;
  provider: MediaProviderName;
  key: string;
  publicUrl: string;
  kind: MediaKind;
  mimeType: string;
  bytes: number;
  totalBytes: number;
  width?: number | null;
  height?: number | null;
  variants: IMediaAssetVariant[];
  status: 'active' | 'pending_delete' | 'deleted';
  deleteAttempts: number;
  lastError?: string;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema<IMediaAssetVariant>(
  {
    key: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    bytes: { type: Number, required: true },
  },
  { _id: false },
);

const mediaAssetSchema = new Schema<IMediaAsset>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    provider: { type: String, enum: ['cloudinary', 'r2'], required: true },
    key: { type: String, required: true },
    publicUrl: { type: String, required: true },
    kind: {
      type: String,
      enum: ['product', 'category', 'logo', 'banner', 'avatar', 'blog'],
      required: true,
    },
    mimeType: { type: String, default: 'image/webp' },
    bytes: { type: Number, default: 0 },
    totalBytes: { type: Number, default: 0 },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    variants: { type: [variantSchema], default: [] },
    status: {
      type: String,
      enum: ['active', 'pending_delete', 'deleted'],
      default: 'active',
    },
    deleteAttempts: { type: Number, default: 0 },
    lastError: { type: String },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mediaAssetSchema.index({ key: 1, provider: 1 }, { unique: true });
mediaAssetSchema.index({ tenantId: 1, status: 1, provider: 1 });
mediaAssetSchema.index({ status: 1, deleteAttempts: 1, updatedAt: 1 });

export const MediaAsset = model<IMediaAsset>('MediaAsset', mediaAssetSchema);
