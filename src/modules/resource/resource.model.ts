import { Schema, model, Document, Types } from 'mongoose';

/* ───────────────────────── Storage gauge (per merchant) ───────────────────────── */
export interface IMerchantStorageState extends Document {
  tenantId: Types.ObjectId;
  usedBytes: number;
  fileCount: number;
  /** Snapshot of the effective limit at the last change (0 = unlimited). Used by admin analytics. */
  limitBytes: number;
  notified: number[];
  reconciledAt?: Date | null;
  lastDriftBytes: number;
}

const storageStateSchema = new Schema<IMerchantStorageState>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    usedBytes: { type: Number, default: 0, min: 0 },
    fileCount: { type: Number, default: 0, min: 0 },
    limitBytes: { type: Number, default: 0 },
    notified: { type: [Number], default: [] },
    reconciledAt: { type: Date, default: null },
    lastDriftBytes: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export const MerchantStorageState = model<IMerchantStorageState>('MerchantStorageState', storageStateSchema);

/* ───────────────────────── Bandwidth usage per billing period ───────────────────────── */
export interface IMerchantResourceUsage extends Document {
  tenantId: Types.ObjectId;
  period: string; // YYYY-MM (UTC)
  image: { bytes: number; requests: number; cacheHit: number; cacheMiss: number };
  general: { bytes: number; requests: number };
  /** daily['01'..'31'] = { imageBytes, imageRequests, generalBytes, generalRequests } */
  daily: Record<string, Record<string, number>>;
  limits: { imageBytes: number; generalBytes: number; combinedBytes: number };
  notified: { image: number[]; general: number[]; combined: number[] };
  /** Window keys already applied to this doc (bounded) → idempotent ingestion. */
  appliedWindows: string[];
  dataThrough?: Date | null;
}

const usageSchema = new Schema<IMerchantResourceUsage>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    period: { type: String, required: true },
    image: {
      bytes: { type: Number, default: 0 },
      requests: { type: Number, default: 0 },
      cacheHit: { type: Number, default: 0 },
      cacheMiss: { type: Number, default: 0 },
    },
    general: {
      bytes: { type: Number, default: 0 },
      requests: { type: Number, default: 0 },
    },
    daily: { type: Schema.Types.Mixed, default: {} },
    limits: {
      imageBytes: { type: Number, default: 0 },
      generalBytes: { type: Number, default: 0 },
      combinedBytes: { type: Number, default: 0 },
    },
    notified: {
      image: { type: [Number], default: [] },
      general: { type: [Number], default: [] },
      combined: { type: [Number], default: [] },
    },
    appliedWindows: { type: [String], default: [] },
    dataThrough: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
usageSchema.index({ tenantId: 1, period: 1 }, { unique: true });
usageSchema.index({ period: 1, 'image.bytes': -1 });
usageSchema.index({ period: 1, 'general.bytes': -1 });
export const MerchantResourceUsage = model<IMerchantResourceUsage>('MerchantResourceUsage', usageSchema);

/* ───────────────────────── Ingestion checkpoints ───────────────────────── */
export interface IResourceIngestCheckpoint extends Document {
  key: string;
  source: string;
  windowStart: Date;
  windowEnd: Date;
  status: 'processing' | 'done' | 'failed';
  leaseUntil?: Date | null;
  attempts: number;
  stats?: Record<string, any>;
  error?: string;
}
const checkpointSchema = new Schema<IResourceIngestCheckpoint>(
  {
    key: { type: String, required: true, unique: true },
    source: { type: String, required: true },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    status: { type: String, enum: ['processing', 'done', 'failed'], default: 'processing' },
    leaseUntil: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    stats: { type: Schema.Types.Mixed },
    error: { type: String },
  },
  { timestamps: true },
);
checkpointSchema.index({ source: 1, status: 1, windowEnd: -1 });
export const ResourceIngestCheckpoint = model<IResourceIngestCheckpoint>('ResourceIngestCheckpoint', checkpointSchema);

/* ───────────────────────── Admin audit log ───────────────────────── */
export interface IResourceAuditLog extends Document {
  actorId?: Types.ObjectId | null;
  action: string;
  entityType: string;
  entityId?: string;
  before?: any;
  after?: any;
  ip?: string;
}
const auditSchema = new Schema<IResourceAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ createdAt: -1 });
export const ResourceAuditLog = model<IResourceAuditLog>('ResourceAuditLog', auditSchema);

/* ───────────────────────── Resource add-on catalogue (admin-defined) ───────────────────────── */
export interface IResourceAddon extends Document {
  name: string;
  description: string;
  category: 'storage' | 'image_bandwidth' | 'general_bandwidth';
  quantityBytes: number;
  displayQuantity: number;
  displayUnit: 'MB' | 'GB';
  price: number;
  promoPrice?: number | null;
  durationType: 'billing_period' | 'days' | 'subscription_bound' | 'permanent';
  durationDays: number;
  billingType: 'one_time' | 'recurring';
  isCustomQuantity: boolean;
  minQuantity: number;
  maxQuantity: number;
  isActive: boolean;
  availablePackageIds: Types.ObjectId[];
  autoRenew: boolean;
  displayOrder: number;
}
const resourceAddonSchema = new Schema<IResourceAddon>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 1000 },
    category: { type: String, enum: ['storage', 'image_bandwidth', 'general_bandwidth'], required: true },
    quantityBytes: { type: Number, required: true, min: 1 },
    displayQuantity: { type: Number, required: true, min: 0 },
    displayUnit: { type: String, enum: ['MB', 'GB'], default: 'GB' },
    price: { type: Number, required: true, min: 0 },
    promoPrice: { type: Number, default: null, min: 0 },
    durationType: {
      type: String,
      enum: ['billing_period', 'days', 'subscription_bound', 'permanent'],
      default: 'billing_period',
    },
    durationDays: { type: Number, default: 30, min: 1 },
    billingType: { type: String, enum: ['one_time', 'recurring'], default: 'one_time' },
    isCustomQuantity: { type: Boolean, default: false },
    minQuantity: { type: Number, default: 1, min: 1 },
    maxQuantity: { type: Number, default: 1, min: 1 },
    isActive: { type: Boolean, default: true },
    availablePackageIds: [{ type: Schema.Types.ObjectId, ref: 'Package' }],
    autoRenew: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
resourceAddonSchema.index({ isActive: 1, category: 1, displayOrder: 1 });
export const ResourceAddon = model<IResourceAddon>('ResourceAddon', resourceAddonSchema);

/* ───────────────────────── Purchases ───────────────────────── */
export interface IResourceAddonPurchase extends Document {
  tenantId: Types.ObjectId;
  addonId: Types.ObjectId;
  snapshot: {
    name: string;
    category: 'storage' | 'image_bandwidth' | 'general_bandwidth';
    quantityBytes: number;
    unitPrice: number;
    durationType: string;
    durationDays: number;
    autoRenew: boolean;
  };
  quantity: number;
  totalPrice: number;
  quantityBytes: number; // snapshot per unit, duplicated top-level for cheap aggregation
  category: 'storage' | 'image_bandwidth' | 'general_bandwidth';
  status: 'pending' | 'active' | 'expired' | 'rejected' | 'refunded' | 'cancelled';
  paymentSubmissionId?: Types.ObjectId | null;
  activatedAt?: Date | null;
  expiresAt?: Date | null;
  expiryNoticeSent: boolean;
  statusHistory: { status: string; at: Date; by?: string; note?: string }[];
}
const purchaseSchema = new Schema<IResourceAddonPurchase>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    addonId: { type: Schema.Types.ObjectId, ref: 'ResourceAddon', required: true },
    snapshot: {
      name: { type: String, required: true },
      category: { type: String, required: true },
      quantityBytes: { type: Number, required: true },
      unitPrice: { type: Number, required: true },
      durationType: { type: String, required: true },
      durationDays: { type: Number, default: 30 },
      autoRenew: { type: Boolean, default: false },
    },
    quantity: { type: Number, required: true, min: 1 },
    totalPrice: { type: Number, required: true, min: 0 },
    quantityBytes: { type: Number, required: true, min: 1 },
    category: { type: String, enum: ['storage', 'image_bandwidth', 'general_bandwidth'], required: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'expired', 'rejected', 'refunded', 'cancelled'],
      default: 'pending',
    },
    // unique + sparse: one payment can only ever activate one purchase (idempotent activation)
    paymentSubmissionId: { type: Schema.Types.ObjectId, ref: 'PlatformPaymentSubmission', default: null },
    activatedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    expiryNoticeSent: { type: Boolean, default: false },
    statusHistory: [
      { _id: false, status: String, at: { type: Date, default: Date.now }, by: String, note: String },
    ],
  },
  { timestamps: true },
);
purchaseSchema.index({ paymentSubmissionId: 1 }, { unique: true, partialFilterExpression: { paymentSubmissionId: { $type: 'objectId' } } });
purchaseSchema.index({ tenantId: 1, status: 1, category: 1 });
purchaseSchema.index({ status: 1, expiresAt: 1 });
export const ResourceAddonPurchase = model<IResourceAddonPurchase>('ResourceAddonPurchase', purchaseSchema);
