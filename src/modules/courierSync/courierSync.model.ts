import { Schema, model } from 'mongoose';
import { ICourierSyncReport } from './courierSync.interface';

const syncDetailSchema = new Schema(
  {
    tenantId:     { type: String, required: true },
    merchantName: { type: String, required: true },
    orderId:      { type: String, required: true },
    provider:     { type: String, required: true },
    oldStatus:    { type: String, required: true },
    newStatus:    { type: String, required: true },
  },
  { _id: false }
);

const skippedDetailSchema = new Schema(
  {
    tenantId:     { type: String, required: true },
    merchantName: { type: String, required: true },
    orderId:      { type: String },
    provider:     { type: String },
    reason:       { type: String, required: true },
    errorType: {
      type: String,
      enum: ['NO_CONFIG', 'NO_PROVIDER', 'UNKNOWN_PROVIDER', 'AUTH_ERROR', 'TRACKING_ERROR', 'NO_STATUS_CHANGE'],
      required: true,
    },
  },
  { _id: false }
);

const courierSyncReportSchema = new Schema<ICourierSyncReport>(
  {
    synced:         { type: Number, required: true, default: 0 },
    updated:        { type: Number, required: true, default: 0 },
    skipped:        { type: Number, required: true, default: 0 },
    details:        { type: [syncDetailSchema],   default: [] },
    skippedDetails: { type: [skippedDetailSchema], default: [] },
    startedAt:      { type: Date, required: true },
    completedAt:    { type: Date, required: true },
    durationMs:     { type: Number, required: true },
  },
  { timestamps: true }
);

export const CourierSyncReport = model<ICourierSyncReport>(
  'CourierSyncReport',
  courierSyncReportSchema
);
