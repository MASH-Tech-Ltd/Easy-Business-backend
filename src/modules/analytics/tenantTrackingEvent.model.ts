import { Schema, model, Document, Types } from 'mongoose';

export type TenantMetaEventName =
  | 'PageView'
  | 'ViewContent'
  | 'AddToCart'
  | 'InitiateCheckout'
  | 'Purchase'
  | 'Contact'
  | 'CompleteRegistration'
  | 'TestEvent';

export type TenantEventDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'retry_scheduled'
  | 'failed'
  | 'skipped';

export interface ITenantTrackingEvent extends Document {
  tenantId: Types.ObjectId;
  eventName: TenantMetaEventName;
  eventId: string;
  eventTime: number;
  eventSourceUrl?: string;
  actionSource: string;
  userData: Record<string, any>;
  customData: Record<string, any>;
  status: TenantEventDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date | null;
  httpStatus?: number;
  fbTraceId?: string;
  errorMessage?: string;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const NINETY_DAYS_IN_SECONDS = 90 * 24 * 60 * 60;

const tenantTrackingEventSchema = new Schema<ITenantTrackingEvent>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    eventName: {
      type: String,
      enum: [
        'PageView',
        'ViewContent',
        'AddToCart',
        'InitiateCheckout',
        'Purchase',
        'Contact',
        'CompleteRegistration',
        'TestEvent',
      ],
      required: true,
      index: true,
    },
    eventId: { type: String, required: true, trim: true },
    eventTime: { type: Number, required: true },
    eventSourceUrl: { type: String, default: '' },
    actionSource: { type: String, default: 'website' },
    userData: { type: Schema.Types.Mixed, default: {} },
    customData: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['pending', 'sent', 'retry_scheduled', 'failed', 'skipped'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    nextRetryAt: { type: Date, default: null, index: true },
    httpStatus: { type: Number },
    fbTraceId: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    sentAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

// Compound index for idempotency per tenant
tenantTrackingEventSchema.index({ tenantId: 1, eventName: 1, eventId: 1 }, { unique: true });
tenantTrackingEventSchema.index({ tenantId: 1, createdAt: -1 });
tenantTrackingEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: NINETY_DAYS_IN_SECONDS });

export const TenantTrackingEvent = model<ITenantTrackingEvent>(
  'TenantTrackingEvent',
  tenantTrackingEventSchema
);
