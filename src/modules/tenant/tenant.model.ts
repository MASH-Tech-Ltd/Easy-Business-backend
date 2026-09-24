import { Schema, model } from 'mongoose';
import { ITenant } from './tenant.interface';

const tenantSchema = new Schema<ITenant>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    domain: { type: String, unique: true, sparse: true },
    customDomain: { type: String, unique: true, sparse: true },
    logo: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'pending' },
    domainStatus: { type: String, enum: ['pending', 'active', 'failed'], default: 'pending' },
    sslValidationRecords: [{ type: Schema.Types.Mixed }],
    contactEmail: { type: String },
    contactPhone: { type: String },
    contactAddress: { type: String },
    description: { type: String },
    theme: { type: Schema.Types.Mixed },
    settings: { type: Schema.Types.Mixed },
    showDemoSeed: { type: Boolean, default: true },
    slugChanges: [{ type: Date }],
  },
  {
    timestamps: true,
  }
);

export const Tenant = model<ITenant>('Tenant', tenantSchema);
