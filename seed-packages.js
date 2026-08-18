import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Package } from './src/modules/package/package.model';
dotenv.config();
const MONGODB_URI = process.env.DATABASE_URL || 'mongodb+srv://mohsinahmed22022_db_user:WS5JzIVFEiEN1k7c@scaleup.kblzvbw.mongodb.net/tenet';
const packages = [
    {
        name: 'Free plan',
        price: 0,
        billingCycle: 'monthly',
        productLimit: 50,
        isActive: true,
    },
    {
        name: 'Basic',
        price: 500,
        billingCycle: 'monthly',
        productLimit: 100,
        isActive: true,
    },
    {
        name: 'Premimus',
        price: 1000,
        billingCycle: 'monthly',
        productLimit: 200,
        isActive: true,
    },
    {
        name: 'Enterprise',
        price: 3000,
        billingCycle: 'monthly',
        productLimit: 500,
        isActive: true,
    },
    {
        name: 'Free plan (Yearly)',
        price: 0,
        billingCycle: 'yearly',
        productLimit: 50,
        isActive: true,
    },
    {
        name: 'Basic',
        price: 5000,
        billingCycle: 'yearly',
        productLimit: 100,
        isActive: true,
    },
    {
        name: 'Premimus',
        price: 10000,
        billingCycle: 'yearly',
        productLimit: 200,
        isActive: true,
    },
    {
        name: 'Enterprise',
        price: 30000,
        billingCycle: 'yearly',
        productLimit: 500,
        isActive: true,
    }
];
async function seedPackages() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');
        console.log('Clearing old packages...');
        await Package.deleteMany({});
        console.log('Seeding packages...');
        await Package.insertMany(packages);
        console.log('Successfully seeded packages!');
        process.exit(0);
    }
    catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}
seedPackages();
