import { Package } from '../modules/package/package.model';

/**
 * Idempotently updates the existing database packages with monthly free credit rules
 * for Courier Automation and Abandoned Checkout.
 * Does NOT drop or re-seed any data.
 */
export const ensurePackageFreeCredits = async (): Promise<void> => {
  try {
    const packages = await Package.find();
    if (!packages || packages.length === 0) return;

    for (const pkg of packages) {
      const nameLower = (pkg.name || '').trim().toLowerCase();
      const price = Number(pkg.price) || 0;

      let courierLimit = 0;
      let abandonedLimit = 0;

      let productLimit = 199;
      let features: string[] = [];
      let tagline = '';
      let description = '';

      if (price === 299 || price === 2990 || nameLower === 'basic') {
        courierLimit = 5;
        abandonedLimit = 5;
        productLimit = 199;
        tagline = 'Essential Storefront for New Sellers & Small Businesses';
        description = 'Launch your brand online with all core store tools, 199 products, and starter free automations.';
        features = [
          'Up to 199 Products Capacity',
          'Courier Automation: 5 Free Orders / Month',
          'Abandoned Checkout: 5 Free Leads / Month',
          'Online Storefront & All 5 Modern Themes',
          'Mash Eco Subdomain & Custom Domain',
          'Cash on Delivery (COD) & Manual Payments',
          'Customer Support: Standard Ticket Support',
          'Google Analytics 4 (GA4): Not included',
          'Meta (Facebook) Pixel & Conversion Tracking: Not included',
          'Advanced Sales & Business Insights: Not included',
          'Automated SMS & Email Marketing: Not included',
          'Multi-channel GTM Custom Scripts: Not included',
          'Advanced Customer Fraud Risk Scoring: Not included',
          'Swift VIP Dedicated 24/7 Priority Support: Not included',
        ];
      } else if (price === 499 || price === 4990 || nameLower === 'standard') {
        courierLimit = 10;
        abandonedLimit = 10;
        productLimit = 399;
        tagline = 'More Capacity & Insights for Growing Businesses';
        description = 'Scale faster with 399 products, double monthly free automations, and native GA4 & Meta Pixel tracking.';
        features = [
          'Up to 399 Products (2x Capacity)',
          'Courier Automation: 10 Free Orders / Month (2x)',
          'Abandoned Checkout: 10 Free Leads / Month (2x)',
          'Online Storefront & All 5 Modern Themes',
          'Mash Eco Subdomain & Custom Domain',
          'Cash on Delivery (COD) & Manual Payments',
          'Customer Support: Priority Support Queue',
          'Google Analytics 4 (GA4) Native Integration',
          'Meta (Facebook) Pixel & Conversion Tracking',
          'Advanced Sales & Conversion Analytics',
          'Automated SMS & Email Marketing Ready',
          'Multi-channel GTM Custom Scripts: Not included',
          'Advanced Customer Fraud Risk Scoring: Not included',
          'Swift VIP Dedicated 24/7 Priority Support: Not included',
        ];
      } else if (price === 799 || price === 7990 || nameLower === 'premium') {
        courierLimit = 15;
        abandonedLimit = 15;
        productLimit = 1500;
        tagline = 'Maximum Power, High Volume & VIP Support';
        description = 'Full-scale power for high catalog volume, triple monthly automations, and Swift VIP support.';
        features = [
          'Up to 699 Products (Maximum Catalog Size)',
          'Courier Automation: 15 Free Orders / Month (3x Volume)',
          'Abandoned Checkout: 15 Free Leads / Month (3x Volume)',
          'Online Storefront & All 5 Modern Themes',
          'Mash Eco Subdomain & Custom Domain',
          'Cash on Delivery (COD) & Manual Payments',
          'Customer Support: Fast-Track VIP Ticket Support',
          'Google Analytics 4 (GA4) Native Integration',
          'Meta (Facebook) Pixel & Conversion Tracking',
          'Advanced Sales & Business Insights Dashboard',
          'Automated SMS & Email Marketing Ready',
          'Multi-channel GTM Tracking & Custom Scripts',
          'Advanced Customer Fraud Risk Scoring',
          'Swift VIP Dedicated 24/7 Priority Support',
        ];
      }

      if (courierLimit === 0 && abandonedLimit === 0) continue;

      await Package.updateOne(
        { _id: pkg._id },
        {
          $set: {
            productLimit,
            freeCourierLimit: courierLimit,
            freeAbandonedLimit: abandonedLimit,
            tagline,
            description,
            features,
          },
        }
      );
    }
    console.log('✅ Package monthly free credits and English features verified in database.');
  } catch (error) {
    console.error('Failed to verify package free credits in database:', error);
  }
};

if (require.main === module) {
  const { connectDatabase } = require('../database/db');
  connectDatabase()
    .then(async () => {
      await ensurePackageFreeCredits();
      process.exit(0);
    })
    .catch((err: any) => {
      console.error(err);
      process.exit(1);
    });
}
