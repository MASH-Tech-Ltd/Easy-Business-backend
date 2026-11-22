import mongoose, { Schema, Document } from 'mongoose';

export interface IDemoVideoItem {
  pageId: string;
  pageName: string;
  path: string;
  section: string;
  youtubeUrl: string;
  isActive: boolean;
  title?: string;
  description?: string;
}

export const DEFAULT_DEMO_VIDEOS: IDemoVideoItem[] = [
  // Main
  {
    pageId: 'dashboard',
    pageName: 'Dashboard',
    path: '/dashboard',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Dashboard Overview & Metrics',
    description: 'Learn how to monitor store performance, key metrics and sales overview.',
  },
  {
    pageId: 'orders',
    pageName: 'Orders Management',
    path: '/dashboard/orders',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Managing Orders & Statuses',
    description: 'Process orders, update fulfillment statuses, and manage invoices.',
  },
  {
    pageId: 'manualOrders',
    pageName: 'Manual Order',
    path: '/dashboard/manual-orders',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Creating Manual Orders',
    description: 'Step-by-step tutorial to create manual orders on behalf of phone or social customers.',
  },
  {
    pageId: 'products',
    pageName: 'Products Management',
    path: '/dashboard/products',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Adding & Managing Products',
    description: 'Create products, configure variants, inventory, and image galleries.',
  },
  {
    pageId: 'categories',
    pageName: 'Categories',
    path: '/dashboard/categories',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Product Categories',
    description: 'Organize catalog into main and sub-categories for easy browsing.',
  },
  {
    pageId: 'customers',
    pageName: 'Customers',
    path: '/dashboard/customers',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Customer Directory & Retention',
    description: 'View customer purchase histories, orders count, and loyalty metrics.',
  },
  {
    pageId: 'courier',
    pageName: 'Courier Automation',
    path: '/dashboard/courier-automation',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Courier Integration & Automation',
    description: 'Integrate Steadfast, Pathao & RedX for one-click consignment dispatch.',
  },
  {
    pageId: 'fraudCheck',
    pageName: 'Fraud Check',
    path: '/dashboard/fraud-check',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Fraud Detection & Risk Analysis',
    description: 'Detect high-risk orders, fake buyers and delivery failure patterns.',
  },
  {
    pageId: 'checkoutLeads',
    pageName: 'Checkout Leads',
    path: '/dashboard/checkout-leads',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Abandoned Checkout Recovery',
    description: 'View dropped checkouts and follow up with interested buyers to boost conversions.',
  },
  {
    pageId: 'blockedPhones',
    pageName: 'Blocked Phones',
    path: '/dashboard/blocked-phones',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Blacklisting Suspicious Phone Numbers',
    description: 'Blacklist fraudulent numbers to prevent fake and spam orders.',
  },
  {
    pageId: 'notifications',
    pageName: 'Notifications',
    path: '/dashboard/notifications',
    section: 'Main',
    youtubeUrl: '',
    isActive: true,
    title: 'Store Activity & Notifications',
    description: 'Manage real-time alerts for orders, stock levels, and store activities.',
  },

  // Shop & Growth
  {
    pageId: 'impressions',
    pageName: 'Impressions & Clicks',
    path: '/dashboard/impressions',
    section: 'Shop & Growth',
    youtubeUrl: '',
    isActive: true,
    title: 'Store Traffic & Product Impressions',
    description: 'Analyze impressions, clicks and click-through rates across products.',
  },
  {
    pageId: 'analytics',
    pageName: 'Analytics',
    path: '/dashboard/analytics',
    section: 'Shop & Growth',
    youtubeUrl: '',
    isActive: true,
    title: 'Sales & Growth Analytics',
    description: 'Deep dive into revenue trends, top-selling products, and conversion stats.',
  },
  {
    pageId: 'pixels',
    pageName: 'Tracking & Pixels',
    path: '/dashboard/pixels',
    section: 'Shop & Growth',
    youtubeUrl: '',
    isActive: true,
    title: 'Facebook Pixel & Server CAPI',
    description: 'Configure Meta Pixel, Conversion API (CAPI), and Google Tag Manager.',
  },
  {
    pageId: 'themes',
    pageName: 'Themes',
    path: '/dashboard/themes',
    section: 'Shop & Growth',
    youtubeUrl: '',
    isActive: true,
    title: 'Storefront Themes & Branding',
    description: 'Browse, preview, and apply storefront themes to match your brand style.',
  },
  {
    pageId: 'referAndEarn',
    pageName: 'Refer & Earn (৳)',
    path: '/dashboard/refer-and-earn',
    section: 'Shop & Growth',
    youtubeUrl: '',
    isActive: true,
    title: 'Merchant Referral Program',
    description: 'Earn points and subscription discounts by inviting fellow store owners.',
  },

  // Settings
  {
    pageId: 'profile',
    pageName: 'Profile',
    path: '/dashboard/profile',
    section: 'Settings',
    youtubeUrl: '',
    isActive: true,
    title: 'Store Profile & Branding',
    description: 'Update store logo, business contacts, and social media handles.',
  },
  {
    pageId: 'security',
    pageName: 'Security & 2FA',
    path: '/dashboard/security',
    section: 'Settings',
    youtubeUrl: '',
    isActive: true,
    title: 'Security & Authentication',
    description: 'Manage passwords, two-factor authentication, and active login sessions.',
  },
  {
    pageId: 'domain',
    pageName: 'Domain',
    path: '/dashboard/domain',
    section: 'Settings',
    youtubeUrl: '',
    isActive: true,
    title: 'Custom Domain Setup',
    description: 'Connect and verify custom domains with CNAME & DNS record guidance.',
  },
  {
    pageId: 'apiKeys',
    pageName: 'API Keys',
    path: '/dashboard/api-keys',
    section: 'Settings',
    youtubeUrl: '',
    isActive: true,
    title: 'API Keys & Developer Integrations',
    description: 'Generate secure API credentials for third-party developer integrations.',
  },
  {
    pageId: 'paymentMethods',
    pageName: 'Payment Methods',
    path: '/dashboard/payment-methods',
    section: 'Settings',
    youtubeUrl: '',
    isActive: true,
    title: 'Payment Gateway Configuration',
    description: 'Set up Cash on Delivery, bKash, Nagad, Rocket, and manual payment accounts.',
  },
  {
    pageId: 'support',
    pageName: 'Support',
    path: '/dashboard/support',
    section: 'Settings',
    youtubeUrl: '',
    isActive: true,
    title: 'Support Tickets Helpdesk',
    description: 'Open support tickets and get help from our 24/7 technical team.',
  },
  {
    pageId: 'subscription',
    pageName: 'Subscription',
    path: '/dashboard/subscription',
    section: 'Settings',
    youtubeUrl: '',
    isActive: true,
    title: 'Plans & Subscription Billing',
    description: 'Review plan quotas, upgrade plans, buy add-ons, and view payment invoices.',
  },
];

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
    'design-06'?: string;
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
  demoVideosMasterEnabled?: boolean;
  demoVideos?: IDemoVideoItem[];
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
      'design-06': { type: String, default: '' },
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
    demoVideosMasterEnabled: { type: Boolean, default: true },
    demoVideos: {
      type: [
        {
          pageId: { type: String, required: true },
          pageName: { type: String, required: true },
          path: { type: String, required: true },
          section: { type: String, default: 'Main' },
          youtubeUrl: { type: String, default: '' },
          isActive: { type: Boolean, default: true },
          title: { type: String, default: '' },
          description: { type: String, default: '' },
        },
      ],
      default: DEFAULT_DEMO_VIDEOS,
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
