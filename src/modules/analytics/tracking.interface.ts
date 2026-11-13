import { Document, Types } from 'mongoose';

export interface IProviderConfig {
  enabled: boolean;
  measurementId?: string;
  pixelId?: string;
  containerId?: string;
}

export interface IMetaEventToggles {
  PageView: boolean;
  ViewContent: boolean;
  CompleteRegistration: boolean;
  StartTrial: boolean;
  InitiateCheckout: boolean;
  Purchase: boolean;
  Contact: boolean;
}

export interface IMetaTrackingDiagnostics {
  lastTestAt?: Date | null;
  lastTestStatus?: 'idle' | 'success' | 'failed';
  lastTestMessage?: string;
  lastEventAt?: Date | null;
  lastEventName?: string;
  lastEventStatus?: 'idle' | 'sent' | 'failed';
  lastErrorMessage?: string;
  lastErrorAt?: Date | null;
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
    capiEnabled?: boolean;
    capiAccessTokenEncrypted?: string;
    capiTokenMasked?: string;
    graphApiVersion?: string;
    testEventCode?: string;
    events?: IMetaEventToggles;
    diagnostics?: IMetaTrackingDiagnostics;
  };
  googleTagManager: {
    enabled: boolean;
    containerId: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
