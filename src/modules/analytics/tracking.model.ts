import { Schema, model } from 'mongoose';
import { ITrackingConfig } from './tracking.interface';

const trackingConfigSchema = new Schema<ITrackingConfig>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
    isPlatform: { type: Boolean, default: false, index: true },
    googleAnalytics: {
      enabled: { type: Boolean, default: false },
      measurementId: { type: String, default: '', trim: true },
    },
    metaPixel: {
      enabled: { type: Boolean, default: false },
      pixelId: { type: String, default: '', trim: true },
    },
    googleTagManager: {
      enabled: { type: Boolean, default: false },
      containerId: { type: String, default: '', trim: true },
    },
  },
  {
    timestamps: true,
  }
);

export const TrackingConfig = model<ITrackingConfig>('TrackingConfig', trackingConfigSchema);
