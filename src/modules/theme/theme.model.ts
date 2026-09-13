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

export interface IBannerSetting {
  image?: {
    public_id: string;
    secure_url: string;
  };
  title?: string;
  subtitle?: string;
  buttonText?: string;
  buttonLink?: string;
}

export interface IShippingZone {
  name: string;
  cost: number;
  division?: string;
  districts?: string[];
}

export interface ITheme extends Document {
  tenantId: Types.ObjectId;
  themeId: string;
  primaryColor: string;
  fontFamily: string;
  language?: string;
  currencySymbol?: string;
  footer?: IFooterSetting;
  banner?: IBannerSetting;
  buttonColors?: {
    addToCart?: string;
    buyNow?: string;
  };
  shippingZones?: IShippingZone[];
  defaultShippingCost?: number;
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

const bannerSchema = new Schema<IBannerSetting>({
  image: {
    public_id: { type: String, default: '' },
    secure_url: { type: String, default: '' },
  },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  buttonText: { type: String, default: '' },
  buttonLink: { type: String, default: '' },
}, { _id: false });

const themeSchema = new Schema<ITheme>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    themeId: { type: String, default: 'light' },
    primaryColor: { type: String, default: '#5022C3' },
    fontFamily: { type: String, default: 'Inter' },
    language: { type: String, enum: ['en', 'bn'], default: 'en' },
    currencySymbol: { type: String, default: '৳' },
    footer: { type: footerSchema, default: () => ({}) },
    banner: { type: bannerSchema, default: () => ({}) },
    buttonColors: {
      addToCart: { type: String, default: '' },
      buyNow: { type: String, default: '' },
    },
    shippingZones: {
      type: [
        {
          name: { type: String, required: true },
          cost: { type: Number, required: true, default: 0 },
          division: { type: String, default: '' },
          districts: [{ type: String }],
        }
      ],
      default: [],
    },
    defaultShippingCost: { type: Number, default: 120 },
  },
  { timestamps: true }
);

export const Theme = model<ITheme>('Theme', themeSchema);
