const mongoose = require('mongoose');

const uri = "mongodb+srv://mohsinahmed22022_db_user:WS5JzIVFEiEN1k7c@scaleup.kblzvbw.mongodb.net/tenet";

const addons = [
  {
    name: "Abandoned Checkout",
    slug: "abandoned_checkout",
    description: "Capture and recover abandoned checkout leads to increase sales.",
    price: 9.99,
    billingCycle: "monthly",
    defaultLimit: 100,
    isActive: true,
  },
  {
    name: "Fraud Check",
    slug: "fraud_check",
    description: "Advanced fraud detection for your orders.",
    price: 19.99,
    billingCycle: "monthly",
    defaultLimit: 50,
    isActive: true,
  },
  {
    name: "SMS Notifications",
    slug: "sms_notifications",
    description: "Send automated SMS updates to your customers.",
    price: 14.99,
    billingCycle: "monthly",
    defaultLimit: 500,
    isActive: true,
  },
  {
    name: "Email Marketing",
    slug: "mail_marketing",
    description: "Powerful email marketing tools to boost retention.",
    price: 29.99,
    billingCycle: "monthly",
    defaultLimit: 10000,
    isActive: true,
  },
  {
    name: "Advanced Analytics",
    slug: "analytic_reports",
    description: "Deep dive into your store's performance with custom reports.",
    price: 49.99,
    billingCycle: "yearly",
    defaultLimit: 100,
    isActive: true,
  },
  {
    name: "Courier Automation",
    slug: "courier_automation",
    description: "Automate your shipping and fulfillment processes seamlessly.",
    price: 39.99,
    billingCycle: "monthly",
    defaultLimit: 1000,
    isActive: true,
  }
];

mongoose.connect(uri)
  .then(async () => {
    console.log("Connected to MongoDB.");
    const Addon = mongoose.connection.collection('addons');
    
    for (const addon of addons) {
      const existing = await Addon.findOne({ slug: addon.slug });
      if (!existing) {
        await Addon.insertOne({
          ...addon,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        console.log(`Created addon: ${addon.name}`);
      } else {
        console.log(`Addon already exists: ${addon.name}`);
      }
    }
    
    console.log("Seeding complete.");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
