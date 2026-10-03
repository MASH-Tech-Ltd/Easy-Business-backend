import mongoose, { Schema, Document } from 'mongoose';

export interface IGlobalSettings extends Document {
  platformName: string;
  supportEmail: string;
  currency: string;
  timezone: string;
  maintenanceMode: boolean;
  maxTenants: number;
  allowRegistration: boolean;
  themePreviews: {
    'design-01'?: string;
    'design-02'?: string;
    'design-03'?: string;
    'design-04'?: string;
    'design-05'?: string;
    [key: string]: string | undefined;
  };
  createdAt: Date;
  updatedAt: Date;
}

const globalSettingsSchema = new Schema<IGlobalSettings>(
  {
    platformName: { type: String, default: 'MASH ECO' },
    supportEmail: { type: String, default: 'support@masheco.com' },
    currency: { type: String, default: 'BDT' },
    timezone: { type: String, default: 'UTC+06:00' },
    maintenanceMode: { type: Boolean, default: false },
    maxTenants: { type: Number, default: 100 },
    allowRegistration: { type: Boolean, default: true },
    themePreviews: {
      'design-01': { type: String, default: '' },
      'design-02': { type: String, default: '' },
      'design-03': { type: String, default: '' },
      'design-04': { type: String, default: '' },
      'design-05': { type: String, default: '' },
    },
  },
  { timestamps: true }
);

export const GlobalSetting = mongoose.model<IGlobalSettings>('GlobalSetting', globalSettingsSchema);
