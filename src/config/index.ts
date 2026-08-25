import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const isProduction = process.env.NODE_ENV === 'production';

// SECURITY FIX: In production, crash fast if required secrets are missing or using weak defaults.
// This prevents the app from running with trivially guessable secrets if .env is misconfigured.
const requireSecret = (key: string, fallback: string): string => {
  const value = process.env[key];
  if (!value) {
    if (isProduction) {
      console.error(`FATAL: Required environment variable '${key}' is not set in production. Shutting down.`);
      process.exit(1);
    }
    console.warn(`WARN: '${key}' not set. Using insecure fallback — never use in production!`);
    return fallback;
  }
  // Guard against known weak/default values in production
  if (isProduction && ['secret', 'super_secret_jwt_key_for_famous_electronics', 'superadmin123'].includes(value)) {
    console.error(`FATAL: Environment variable '${key}' is using a weak default value in production. Shutting down.`);
    process.exit(1);
  }
  return value;
};

export default {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 8000,
  database_url: process.env.DATABASE_URL || 'mongodb://localhost:27017/electronics',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  jwt_secret: requireSecret('JWT_SECRET', 'insecure-dev-only-secret'),
  jwt_expires_in: process.env.JWT_EXPIRES_IN || '7d',
  bcrypt_salt_rounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 12,
  super_admin_email: process.env.SUPER_ADMIN_EMAIL || 'admin@famouselectronics.com',
  super_admin_password: requireSecret('SUPER_ADMIN_PASSWORD', 'insecure-dev-password'),
  base_domain: process.env.BASE_DOMAIN || 'localhost',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
};
