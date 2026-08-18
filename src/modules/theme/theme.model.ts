import { Schema, model, Document, Types } from 'mongoose';

export interface IFooterSetting {
  socialLinks?: {
    facebook?: string;
    youtube?: string;
    tiktok?: string;
  };
  contactInfo?: {
    email?: string;
    phone?: string;
    address?: string;
  };
  policies?: {
    aboutUs?: string;
    privacyPolicy?: string;
    termsAndConditions?: string;
    returnPolicy?: string;
  };
  copyrightText?: string;
}

export interface ITheme extends Document {
  tenantId: Types.ObjectId;
  themeId: string;
  primaryColor: string;
  fontFamily: string;
  language?: string;
  footer?: IFooterSetting;
}

const footerSchema = new Schema<IFooterSetting>({
  socialLinks: {
    facebook: { type: String, default: '' },
    youtube: { type: String, default: '' },
    tiktok: { type: String, default: '' },
  },
  contactInfo: {
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
  },
  policies: {
    aboutUs: { type: String, default: '' },
    privacyPolicy: { type: String, default: '' },
    termsAndConditions: { type: String, default: '' },
    returnPolicy: { type: String, default: '' },
  },
  copyrightText: { type: String, default: '' },
}, { _id: false });

const themeSchema = new Schema<ITheme>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    themeId: { type: String, default: 'light' },
    primaryColor: { type: String, default: '#5022C3' },
    fontFamily: { type: String, default: 'Inter' },
    language: { type: String, enum: ['en', 'bn'], default: 'en' },
    footer: { type: footerSchema, default: () => ({}) },
  },
  { timestamps: true }
);

export const Theme = model<ITheme>('Theme', themeSchema);
