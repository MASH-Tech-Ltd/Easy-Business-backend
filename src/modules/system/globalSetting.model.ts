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
  couriers: {
    id: string;
    isActive: boolean;
    badge: 'none' | 'new' | 'beta';
    message?: string;
  }[];
  sidebarMenu: {
    id: string;
    isActive: boolean;
    badge: 'none' | 'new' | 'beta';
    message?: string;
  }[];
  socialLinks: {
    facebook?: { url: string; isActive: boolean };
    instagram?: { url: string; isActive: boolean };
    twitter?: { url: string; isActive: boolean };
    linkedin?: { url: string; isActive: boolean };
    youtube?: { url: string; isActive: boolean };
    [key: string]: { url: string; isActive: boolean } | undefined;
  };
  affiliateSettings: {
    programEnabled: boolean;
    allowAffiliateRegistration: boolean;
    maxAffiliates: number;
    approvalMode: 'auto' | 'manual';
    referralCodePrefix: string;
    extraTrialDaysForReferredMerchant: number;
    termsAndConditions: string;
    defaultCommissionRate: number;
    commissionDurationMonths: number;
    commissionType: 'recurring' | 'one_time';
    commissionBasis: 'actual_paid';
    commissionApprovalMode: 'auto' | 'manual';
    holdDays: number;
    autoReverseOnRefund: boolean;
    withdrawalsEnabled: boolean;
    minimumWithdrawalAmount: number;
    maximumWithdrawalAmount: number;
    supportedMethods: string[];
    withdrawalApprovalRequired: boolean;
    notifications: {
      onRegistration: boolean;
      onCommissionGenerated: boolean;
      onCommissionApproved: boolean;
      onWithdrawalRequested: boolean;
      onWithdrawalCompleted: boolean;
      onWithdrawalRejected: boolean;
    };
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
    couriers: {
      type: [
        {
          id: { type: String, required: true },
          isActive: { type: Boolean, default: true },
          badge: { type: String, enum: ['none', 'new', 'beta'], default: 'none' },
          message: { type: String, default: '' },
        }
      ],
      default: [
        { id: 'pathao', isActive: true, badge: 'none', message: '' },
        { id: 'steadfast', isActive: true, badge: 'none', message: '' },
        { id: 'redx', isActive: true, badge: 'none', message: '' },
      ],
    },
    sidebarMenu: {
      type: [
        {
          id: { type: String, required: true },
          isActive: { type: Boolean, default: true },
          badge: { type: String, enum: ['none', 'new', 'beta'], default: 'none' },
          message: { type: String, default: '' },
        }
      ],
      default: [
        { id: 'manualOrders', isActive: true, badge: 'new', message: '' },
        { id: 'courier', isActive: true, badge: 'beta', message: '' },
        { id: 'fraudCheck', isActive: true, badge: 'beta', message: '' },
        { id: 'checkoutLeads', isActive: true, badge: 'beta', message: '' },
        { id: 'apiKeys', isActive: true, badge: 'beta', message: '' },
      ],
    },
    socialLinks: {
      type: Object,
      default: {
        facebook: { url: '', isActive: true },
        instagram: { url: '', isActive: true },
        twitter: { url: '', isActive: true },
        linkedin: { url: '', isActive: true },
        youtube: { url: '', isActive: true },
      },
    },
    affiliateSettings: {
      programEnabled: { type: Boolean, default: true },
      allowAffiliateRegistration: { type: Boolean, default: true },
      maxAffiliates: { type: Number, default: 500 },
      approvalMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
      referralCodePrefix: { type: String, default: 'MASH' },
      extraTrialDaysForReferredMerchant: { type: Number, default: 10 },
      termsAndConditions: {
        type: String,
        default: 'Affiliate partners earn 30% recurring commission for 6 months on actual subscription payments made by referred merchants. Minimum withdrawal is ৳100.',
      },
      defaultCommissionRate: { type: Number, default: 30 },
      commissionDurationMonths: { type: Number, default: 6 },
      commissionType: { type: String, enum: ['recurring', 'one_time'], default: 'recurring' },
      commissionBasis: { type: String, enum: ['actual_paid'], default: 'actual_paid' },
      commissionApprovalMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
      holdDays: { type: Number, default: 0 },
      autoReverseOnRefund: { type: Boolean, default: true },
      withdrawalsEnabled: { type: Boolean, default: true },
      minimumWithdrawalAmount: { type: Number, default: 100 },
      maximumWithdrawalAmount: { type: Number, default: 50000 },
      supportedMethods: {
        type: [String],
        default: ['bKash', 'Nagad', 'Rocket', 'Bank'],
      },
      withdrawalApprovalRequired: { type: Boolean, default: true },
      notifications: {
        onRegistration: { type: Boolean, default: true },
        onCommissionGenerated: { type: Boolean, default: true },
        onCommissionApproved: { type: Boolean, default: true },
        onWithdrawalRequested: { type: Boolean, default: true },
        onWithdrawalCompleted: { type: Boolean, default: true },
        onWithdrawalRejected: { type: Boolean, default: true },
      },
    },
  },
  { timestamps: true }
);

export const GlobalSetting = mongoose.model<IGlobalSettings>('GlobalSetting', globalSettingsSchema);
