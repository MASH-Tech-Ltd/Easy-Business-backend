import { Document, Types } from 'mongoose';

export interface IProviderConfig {
  enabled: boolean;
  measurementId?: string;
  pixelId?: string;
  containerId?: string;
}

export interface ITrackingConfig extends Document {
  tenantId?: Types.ObjectId;
  isPlatform: boolean;
  googleAnalytics: {
    enabled: boolean;
    measurementId: string;
  };
  metaPixel: {
    enabled: boolean;
    pixelId: string;
  };
  googleTagManager: {
    enabled: boolean;
    containerId: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
