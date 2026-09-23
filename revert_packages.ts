import { connectDatabase } from './src/database/db';
import { Package } from './src/modules/package/package.model';

const basicFeatures = [
  "Up to 199 Products",
  "Professional Online Store",
  "Product, Category & Order Management",
  "Customer Management",
  "Cash on Delivery (COD)",
  "MASH ECO Subdomain & Custom Domain Support",
  "All Available Store Themes",
  "Basic Dashboard & Mobile-Friendly Store",
  "Support: Standard Ticket Support (Submit a ticket and our team will review and respond accordingly).",
  "Best For: New ventures and small businesses with a limited product lineup."
];

const standardFeatures = [
  "Up to 399 Products",
  "Professional Online Store",
  "Product, Category & Order Management",
  "Customer Management",
  "Cash on Delivery (COD)",
  "MASH ECO Subdomain & Custom Domain Support",
  "All Available Store Themes",
  "Basic Dashboard & Mobile-Friendly Store",
  "Support: Priority Support (Get direct messaging access alongside standard tickets, handled with priority).",
  "Best For: Fast-growing businesses handling regular daily orders."
];

const premiumFeatures = [
  "Up to 400 Products",
  "Professional Online Store",
  "Product, Category & Order Management",
  "Customer Management",
  "Cash on Delivery (COD)",
  "MASH ECO Subdomain & Custom Domain Support",
  "All Available Store Themes",
  "Basic Dashboard & Mobile-Friendly Store",
  "Support: Swift Priority Support (Fastest turnaround via direct messaging and priority ticketing for critical issues).",
  "Best For: Established e-commerce stores with large catalogs and high order volume."
];

async function update() {
  await connectDatabase();
  console.log("Connected to DB");

  // Revert monthly packages
  await Package.updateOne({ name: 'Starter', billingCycle: 'monthly' }, { 
    name: 'Basic', 
    price: 299, 
    productLimit: 199, 
    tagline: '',
    description: 'Perfect for growing businesses that need basic features and customization.',
    features: basicFeatures 
  });
  // fallback if they are already named Basic
  await Package.updateOne({ name: 'Basic', billingCycle: 'monthly' }, { 
    name: 'Basic', 
    price: 299, 
    productLimit: 199, 
    tagline: '',
    description: 'Perfect for growing businesses that need basic features and customization.',
    features: basicFeatures 
  });
  
  await Package.updateOne({ name: 'Business', billingCycle: 'monthly' }, { 
    name: 'Standard', 
    price: 499, 
    productLimit: 399, 
    tagline: '',
    description: 'Perfect for growing businesses that need standard features and customization.',
    features: standardFeatures 
  });
  await Package.updateOne({ name: 'Standard', billingCycle: 'monthly' }, { 
    name: 'Standard', 
    price: 499, 
    productLimit: 399, 
    tagline: '',
    description: 'Perfect for growing businesses that need standard features and customization.',
    features: standardFeatures 
  });
  
  await Package.updateOne({ name: 'Pro', billingCycle: 'monthly' }, { 
    name: 'Premium', 
    price: 499, 
    productLimit: 400, 
    tagline: '',
    description: 'Perfect for growing businesses that need premium features and customization.',
    features: premiumFeatures 
  });
  await Package.updateOne({ name: 'Premium', billingCycle: 'monthly' }, { 
    name: 'Premium', 
    price: 499, 
    productLimit: 400, 
    tagline: '',
    description: 'Perfect for growing businesses that need premium features and customization.',
    features: premiumFeatures 
  });

  // Revert yearly packages
  await Package.updateOne({ name: 'Starter', billingCycle: 'yearly' }, { 
    name: 'Basic', 
    price: 2990, 
    productLimit: 199, 
    tagline: '',
    description: 'Perfect for growing businesses that need basic features and customization.',
    features: basicFeatures 
  });
  await Package.updateOne({ name: 'Basic', billingCycle: 'yearly' }, { 
    name: 'Basic', 
    price: 2990, 
    productLimit: 199, 
    tagline: '',
    description: 'Perfect for growing businesses that need basic features and customization.',
    features: basicFeatures 
  });
  
  await Package.updateOne({ name: 'Business', billingCycle: 'yearly' }, { 
    name: 'Standard', 
    price: 4990, 
    productLimit: 399, 
    tagline: '',
    description: 'Perfect for growing businesses that need standard features and customization.',
    features: standardFeatures 
  });
  await Package.updateOne({ name: 'Standard', billingCycle: 'yearly' }, { 
    name: 'Standard', 
    price: 4990, 
    productLimit: 399, 
    tagline: '',
    description: 'Perfect for growing businesses that need standard features and customization.',
    features: standardFeatures 
  });
  
  await Package.updateOne({ name: 'Pro', billingCycle: 'yearly' }, { 
    name: 'Premium', 
    price: 4990, 
    productLimit: 400, 
    tagline: '',
    description: 'Perfect for growing businesses that need premium features and customization.',
    features: premiumFeatures 
  });
  await Package.updateOne({ name: 'Premium', billingCycle: 'yearly' }, { 
    name: 'Premium', 
    price: 4990, 
    productLimit: 400, 
    tagline: '',
    description: 'Perfect for growing businesses that need premium features and customization.',
    features: premiumFeatures 
  });

  console.log("Reverted packages to previous data!");
  process.exit(0);
}

update();
