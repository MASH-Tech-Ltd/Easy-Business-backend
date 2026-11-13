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
      capiEnabled: { type: Boolean, default: false },
      capiAccessTokenEncrypted: { type: String, default: '' },
      capiTokenMasked: { type: String, default: '' },
      graphApiVersion: { type: String, default: 'v21.0', trim: true },
      testEventCode: { type: String, default: '', trim: true },
      events: {
        PageView: { type: Boolean, default: true },
        ViewContent: { type: Boolean, default: true },
        CompleteRegistration: { type: Boolean, default: true },
        StartTrial: { type: Boolean, default: true },
        InitiateCheckout: { type: Boolean, default: true },
        Purchase: { type: Boolean, default: true },
        Contact: { type: Boolean, default: true },
      },
      diagnostics: {
        lastTestAt: { type: Date, default: null },
        lastTestStatus: { type: String, enum: ['idle', 'success', 'failed'], default: 'idle' },
        lastTestMessage: { type: String, default: '' },
        lastEventAt: { type: Date, default: null },
        lastEventName: { type: String, default: '' },
        lastEventStatus: { type: String, enum: ['idle', 'sent', 'failed'], default: 'idle' },
        lastErrorMessage: { type: String, default: '' },
        lastErrorAt: { type: Date, default: null },
      },
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
