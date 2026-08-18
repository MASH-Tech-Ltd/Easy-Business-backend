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
    contactEmail: { type: String },
    contactPhone: { type: String },
    contactAddress: { type: String },
    theme: { type: Schema.Types.Mixed },
    settings: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
  }
);

export const Tenant = model<ITenant>('Tenant', tenantSchema);
