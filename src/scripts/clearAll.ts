import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME as string,
  api_key: process.env.CLOUDINARY_API_KEY as string,
  api_secret: process.env.CLOUDINARY_API_SECRET as string,
});

const clearAll = async () => {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(process.env.DATABASE_URL as string);
    console.log('Connected to database.');

    console.log('Dropping database...');
    await mongoose.connection.db?.dropDatabase();
    console.log('Database dropped successfully.');

    console.log('Clearing Cloudinary resources...');
    
    // Delete all resources (images/videos)
    const res = await cloudinary.api.delete_all_resources();
    console.log('Cloudinary resources deleted:', res);
    
    console.log('All clearing operations completed successfully.');
  } catch (error) {
    console.error('Error during clearing:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

clearAll();
