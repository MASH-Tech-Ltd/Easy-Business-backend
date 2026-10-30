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
      const rawPrice = Number(pkg.price) || 0;
      const billingCycle = (pkg.billingCycle || '').toLowerCase();

      // Use monthly equivalent for yearly packages so limits are per-month
      const monthlyPrice = billingCycle === 'yearly' ? rawPrice / 12 : rawPrice;

      // Dynamic formula: courier = floor(monthly_price / 10), abandoned = floor(monthly_price / 10 * 2)
      const courierLimit = Math.floor(monthlyPrice / 10);
      const abandonedLimit = Math.floor((monthlyPrice / 10) * 2);

      // Derive tier-specific metadata from plan name
      let productLimit = pkg.productLimit || 199;
      let features: string[] = [];
      let tagline = '';
      let description = '';

      if (nameLower === 'basic') {
        productLimit = pkg.productLimit || 199;
        tagline = 'Essential Storefront for New Sellers & Small Businesses';
        description = `Launch your brand online with all core store tools, ${productLimit} products, and ${courierLimit} free courier orders/month.`;
        features = [
          `Up to ${productLimit} Products Capacity`,
          `Courier Automation: ${courierLimit} Free Orders / Month`,
          `Abandoned Checkout: ${abandonedLimit} Free Leads / Month`,
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
      } else if (nameLower === 'standard') {
        productLimit = pkg.productLimit || 399;
        tagline = 'More Capacity & Insights for Growing Businesses';
        description = `Scale faster with ${productLimit} products, ${courierLimit} free courier orders/month, and native GA4 & Meta Pixel tracking.`;
        features = [
          `Up to ${productLimit} Products (2x Capacity)`,
          `Courier Automation: ${courierLimit} Free Orders / Month`,
          `Abandoned Checkout: ${abandonedLimit} Free Leads / Month`,
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
      } else if (nameLower === 'premium') {
        productLimit = pkg.productLimit || 1500;
        tagline = 'Maximum Power, High Volume & VIP Support';
        description = `Full-scale power for high catalog volume, ${courierLimit} free courier orders/month, and Swift VIP support.`;
        features = [
          `Up to ${productLimit} Products (Maximum Catalog Size)`,
          `Courier Automation: ${courierLimit} Free Orders / Month`,
          `Abandoned Checkout: ${abandonedLimit} Free Leads / Month`,
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
