import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';
import { BlockedIp } from './src/modules/system/security.model';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const clearBlockedIps = async () => {
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL not found in .env');

    await mongoose.connect(dbUrl);
    console.log('Connected to MongoDB');

    const result = await BlockedIp.deleteMany({});
    console.log(`Successfully deleted ${result.deletedCount} blocked IP(s).`);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error clearing blocked IPs:', error);
    process.exit(1);
  }
};

clearBlockedIps();
