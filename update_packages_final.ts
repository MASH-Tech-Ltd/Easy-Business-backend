import { connectDatabase } from './src/database/db';
import { Package } from './src/modules/package/package.model';

const starterFeatures = [
  "Capacity: Up to 100 Products",
  "Key Features:",
  "- Professional Online Store",
  "- Product, Category & Order Management",
  "- Customer Management",
  "- Cash on Delivery (COD)",
  "- MASH ECO Subdomain & Custom Domain Support",
  "- All Available Store Themes",
  "- Basic Dashboard & Mobile-Friendly Store",
  "- Regular System Updates",
  "Support: Standard Ticket Support (Submit a ticket and our team will review and respond accordingly).",
  "Best For: New ventures and small businesses with a limited product lineup."
];

const businessFeatures = [
  "Capacity: Up to 300 Products",
  "Key Features: Everything in Starter, plus:",
  "- Advanced Dashboard",
  "- Sales & Order Insights",
  "- Direct Message Support",
  "- Priority Queue Handling",
  "Support: Priority Support (Get direct messaging access alongside standard tickets, handled with priority).",
  "Best For: Fast-growing businesses handling regular daily orders."
];

const proFeatures = [
  "Capacity: Up to 550 Products",
  "Key Features: Everything in Business, plus:",
  "- Advanced Inventory Management",
  "- Advanced Sales & Order Analytics",
  "- Dedicated Mobile Optimization",
  "- Priority Direct & Ticket Channels",
  "Support: Swift Priority Support (Fastest turnaround via direct messaging and priority ticketing for critical issues).",
  "Best For: Established e-commerce stores with large catalogs and high order volume."
];

async function update() {
  await connectDatabase();
  console.log("Connected to DB");

  // Update monthly packages
  await Package.updateOne({ name: 'Basic', billingCycle: 'monthly' }, { 
    name: 'Starter', 
    price: 199, 
    productLimit: 100, 
    tagline: 'Simple & Affordable Online Store for Small Businesses',
    description: 'Take your Facebook-based business to the next level with a professional online store. The ideal low-cost package with all the essentials to launch your e-commerce journey.',
    features: starterFeatures 
  });
  
  await Package.updateOne({ name: 'Standard', billingCycle: 'monthly' }, { 
    name: 'Business', 
    price: 399, 
    productLimit: 300, 
    tagline: 'More Capacity & Insights for Growing Businesses',
    description: 'As your order volume grows, you need higher capacity and smarter management tools. The Business package is built to scale with your momentum.',
    features: businessFeatures 
  });
  
  await Package.updateOne({ name: 'Premium', billingCycle: 'monthly' }, { 
    name: 'Pro', 
    price: 699, 
    productLimit: 550, 
    tagline: 'Full-Scale Power for High Volume & Large Catalogs',
    description: 'Built for established brands managing a vast product catalog, heavy daily order traffic, and intricate inventory needs.',
    features: proFeatures 
  });

  // Update yearly packages
  await Package.updateOne({ name: 'Basic', billingCycle: 'yearly' }, { 
    name: 'Starter', 
    price: 1990, 
    productLimit: 100, 
    tagline: 'Simple & Affordable Online Store for Small Businesses',
    description: 'Take your Facebook-based business to the next level with a professional online store. The ideal low-cost package with all the essentials to launch your e-commerce journey.',
    features: starterFeatures 
  });
  
  await Package.updateOne({ name: 'Standard', billingCycle: 'yearly' }, { 
    name: 'Business', 
    price: 3990, 
    productLimit: 300, 
    tagline: 'More Capacity & Insights for Growing Businesses',
    description: 'As your order volume grows, you need higher capacity and smarter management tools. The Business package is built to scale with your momentum.',
    features: businessFeatures 
  });
  
  await Package.updateOne({ name: 'Premium', billingCycle: 'yearly' }, { 
    name: 'Pro', 
    price: 6990, 
    productLimit: 550, 
    tagline: 'Full-Scale Power for High Volume & Large Catalogs',
    description: 'Built for established brands managing a vast product catalog, heavy daily order traffic, and intricate inventory needs.',
    features: proFeatures 
  });

  console.log("Updated packages!");
  process.exit(0);
}

update();
