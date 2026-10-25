import { Addon } from '../modules/addon/addon.model';

export const allAddonDefinitions = [
  // 1. Starter & Core Addons (Available on All Plans: Basic, Standard & Premium)
  {
    matchSlugs: ['courier_automation', 'courier-automation'],
    matchNames: ['Courier Automation', 'Courier Automation (Volume Boost)'],
    name: 'Courier Automation',
    slug: 'courier_automation',
    description: 'Automate parcel booking, shipping label generation, and real-time SteadFast & Pathao courier syncing.',
    price: 99,
    billingCycle: 'monthly',
    defaultLimit: 100,
    isActive: true,
    applicablePlans: ['basic', 'standard', 'premium'],
    badge: 'All Plans',
  },
  {
    matchSlugs: ['abandoned_checkout', 'abandoned-checkout'],
    matchNames: ['Abandoned Checkout', 'Abandoned Checkout Recovery'],
    name: 'Abandoned Checkout',
    slug: 'abandoned_checkout',
    description: 'Capture unfinished checkouts and recover lost customers with automated lead alerts and recovery follow-ups.',
    price: 99,
    billingCycle: 'monthly',
    defaultLimit: 50,
    isActive: true,
    applicablePlans: ['basic', 'standard', 'premium'],
    badge: 'All Plans',
  },
  {
    matchSlugs: ['fraud_check_basic', 'fraud_check', 'fraud-check-basic'],
    matchNames: ['Fraud Check (Basic)', 'Fraud Check Basic', 'Fraud Check'],
    name: 'Fraud Check (Basic)',
    slug: 'fraud_check_basic',
    description: 'Order fraud detection checking customer delivery history, cancellation ratios, and risky phone flags.',
    price: 100,
    billingCycle: 'monthly',
    defaultLimit: 50,
    isActive: true,
    applicablePlans: ['basic', 'standard', 'premium'],
    badge: 'All Plans',
  },
  {
    matchSlugs: ['sms_notifications', 'sms-notifications'],
    matchNames: ['SMS Notifications', 'Automated SMS & WhatsApp Alerts'],
    name: 'Automated SMS & WhatsApp Alerts',
    slug: 'sms_notifications',
    description: 'Send instant automated SMS and WhatsApp order confirmations, dispatch updates, and customer OTPs.',
    price: 149,
    billingCycle: 'monthly',
    defaultLimit: 250,
    isActive: true,
    applicablePlans: ['basic', 'standard', 'premium'],
    badge: 'All Plans',
  },

  // 2. Growth Add-ons (Standard & Premium)
  {
    matchSlugs: ['fraud_check_pro', 'fraud-check-pro'],
    matchNames: ['Fraud Check (Pro)', 'Fraud Check Pro'],
    name: 'Fraud Check (Pro)',
    slug: 'fraud_check_pro',
    description: 'Advanced machine learning fraud detection analyzing cross-store blacklist, IP reputation, and return probability.',
    price: 200,
    billingCycle: 'monthly',
    defaultLimit: 200,
    isActive: true,
    applicablePlans: ['standard', 'premium'],
    badge: 'Standard & Premium',
  },
  {
    matchSlugs: ['email_marketing', 'mail_marketing'],
    matchNames: ['Email Marketing', 'Automated Email Marketing & Retention'],
    name: 'Automated Email Marketing & Retention',
    slug: 'email_marketing',
    description: 'Engage and retain buyers with automated cart recovery sequences, promotional blasts, and thank-you emails.',
    price: 199,
    billingCycle: 'monthly',
    defaultLimit: 2500,
    isActive: true,
    applicablePlans: ['standard', 'premium'],
    badge: 'Standard & Premium',
  },

  // 3. New Add-ons for Premium Exclusive
  {
    matchSlugs: ['gtm_custom_scripts', 'gtm-custom-scripts'],
    matchNames: ['Multi-Channel GTM & Custom Tracking Scripts', 'Custom Tracking Scripts'],
    name: 'Multi-Channel GTM & Custom Tracking Scripts',
    slug: 'gtm_custom_scripts',
    description: 'Integrate Google Tag Manager (GTM), meta Pixel and custom tracking headers seamlessly.',
    price: 299,
    billingCycle: 'monthly',
    defaultLimit: 1,
    isActive: true,
    applicablePlans: ['premium'],
    badge: 'Premium Exclusive',
  },
  {
    matchSlugs: ['advanced_analytics', 'analytic_reports'],
    matchNames: ['Advanced Analytics', 'Advanced Sales & Business Insights'],
    name: 'Advanced Sales & Business Insights',
    slug: 'advanced_analytics',
    description: 'Deep dive into cohort analytics, customer lifetime value (LTV), repeat rates, and product profit margins.',
    price: 299,
    billingCycle: 'monthly',
    defaultLimit: 1,
    isActive: true,
    applicablePlans: ['premium'],
    badge: 'Premium Exclusive',
  },
  {
    matchSlugs: ['vip_onboarding', 'vip-onboarding'],
    matchNames: ['VIP Store Onboarding', 'VIP Store Onboarding & Fast-Track Setup'],
    name: 'VIP Store Onboarding & Fast-Track Setup',
    slug: 'vip_onboarding',
    description: 'Dedicated 1-on-1 merchant store setup, domain verification, courier mapping, and theme personalization.',
    price: 499,
    billingCycle: 'one_time',
    defaultLimit: 1,
    isActive: true,
    applicablePlans: ['premium'],
    badge: 'Premium Exclusive',
  },
];

/**
 * Idempotently updates existing add-ons and creates any missing ones.
 */
export const ensureAddons = async (): Promise<void> => {
  try {
    for (const def of allAddonDefinitions) {
      // Find existing by any matching slug or name
      const existing = await Addon.findOne({
        $or: [
          { slug: { $in: def.matchSlugs } },
          { name: { $in: def.matchNames } },
        ],
      });

      if (existing) {
        // Update existing record
        await Addon.updateOne(
          { _id: existing._id },
          {
            $set: {
              name: def.name,
              slug: def.slug,
              description: def.description,
              price: def.price,
              billingCycle: def.billingCycle,
              defaultLimit: def.defaultLimit,
              isActive: def.isActive,
              applicablePlans: def.applicablePlans,
              badge: def.badge,
            },
          }
        );
      } else {
        // Create new addon
        await Addon.create({
          name: def.name,
          slug: def.slug,
          description: def.description,
          price: def.price,
          billingCycle: def.billingCycle as 'monthly' | 'one_time' | 'yearly',
          defaultLimit: def.defaultLimit,
          isActive: def.isActive,
          applicablePlans: def.applicablePlans,
          badge: def.badge,
        });
      }
    }
    console.log('✅ Standard & Premium add-ons successfully updated and synchronized in database.');
  } catch (error) {
    console.error('Failed to ensure add-ons:', error);
  }
};

if (require.main === module) {
  const { connectDatabase } = require('../database/db');
  connectDatabase()
    .then(async () => {
      await ensureAddons();
      process.exit(0);
    })
    .catch((err: any) => {
      console.error(err);
      process.exit(1);
    });
}
