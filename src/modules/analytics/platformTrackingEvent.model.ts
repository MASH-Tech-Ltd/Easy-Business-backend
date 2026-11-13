import { Schema, model, Document } from 'mongoose';

export type PlatformMetaEventName =
  | 'PageView'
  | 'ViewContent'
  | 'CompleteRegistration'
  | 'StartTrial'
  | 'InitiateCheckout'
  | 'Purchase'
  | 'Contact'
  | 'TestEvent';

export type PlatformEventDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'retry_scheduled'
  | 'failed'
  | 'skipped';

export interface IPlatformTrackingEvent extends Document {
  eventName: PlatformMetaEventName;
  eventId: string;
  eventTime: number;
  eventSourceUrl?: string;
  actionSource: string;
  userData: Record<string, any>;
  customData: Record<string, any>;
  status: PlatformEventDeliveryStatus;
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

const platformTrackingEventSchema = new Schema<IPlatformTrackingEvent>(
  {
    eventName: {
      type: String,
      enum: [
        'PageView',
        'ViewContent',
        'CompleteRegistration',
        'StartTrial',
        'InitiateCheckout',
        'Purchase',
        'Contact',
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

platformTrackingEventSchema.index({ eventName: 1, eventId: 1 }, { unique: true });
platformTrackingEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: NINETY_DAYS_IN_SECONDS });

export const PlatformTrackingEvent = model<IPlatformTrackingEvent>(
  'PlatformTrackingEvent',
  platformTrackingEventSchema
);

