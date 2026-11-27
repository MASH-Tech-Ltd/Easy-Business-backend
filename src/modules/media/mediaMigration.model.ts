import { Schema, model, Document, Types } from 'mongoose';

export type MigrationKind = 'product' | 'category' | 'banner' | 'logo' | 'avatar';

export interface IMediaMigrationBackup extends Document {
  tenantId: Types.ObjectId;
  kind: MigrationKind;
  entityId: Types.ObjectId;
  oldPublicId: string;
  oldSecureUrl: string;
  newKey: string;
  newSecureUrl: string;
  status: 'migrated' | 'cleaned' | 'cleanup_failed';
  migratedAt: Date;
  cleanupEligibleAt: Date;
  cleanedAt?: Date | null;
  error?: string | null;
}

const schema = new Schema<IMediaMigrationBackup>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    kind: { type: String, enum: ['product', 'category', 'banner', 'logo', 'avatar'], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    oldPublicId: { type: String, default: '' },
    oldSecureUrl: { type: String, required: true },
    newKey: { type: String, required: true },
    newSecureUrl: { type: String, required: true },
    status: { type: String, enum: ['migrated', 'cleaned', 'cleanup_failed'], default: 'migrated' },
    migratedAt: { type: Date, default: Date.now },
    cleanupEligibleAt: { type: Date, required: true },
    cleanedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

schema.index({ tenantId: 1, status: 1, cleanupEligibleAt: 1 });

export const MediaMigrationBackup = model<IMediaMigrationBackup>('MediaMigrationBackup', schema);
