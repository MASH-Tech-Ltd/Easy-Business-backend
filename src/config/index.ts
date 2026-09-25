import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const isProduction = process.env.NODE_ENV === 'production';

// Block common fallback values and template tokens from running in production
const FORBIDDEN_PROD_SECRETS = new Set([
  'secret',
  'superadmin123',
  'admin123',
  'super_secret_jwt_access_key_for_famous_electronics',
  'super_secret_jwt_refresh_key_for_famous_electronics',
  'super_secret_jwt_key_for_famous_electronics',
  'insecure-dev-access-secret',
  'insecure-dev-refresh-secret',
  'insecure-dev-reset-pass-secret',
  'insecure-dev-password',
]);

/**
 * Validates and retrieves required secrets.
 * Crashes early in production if missing or using insecure template defaults.
 */
const requireSecret = (key: string, devFallback: string): string => {
  const value = process.env[key]?.trim();

  if (!value) {
    if (isProduction) {
      console.error(`[FATAL] Missing required secret '${key}' in production environment.`);
      process.exit(1);
    }
    console.warn(`[WARN] '${key}' not defined. Using local insecure fallback.`);
    return devFallback;
  }

  if (isProduction && FORBIDDEN_PROD_SECRETS.has(value)) {
    console.error(`[FATAL] Secret '${key}' is using an insecure default or template value in production.`);
    process.exit(1);
  }

  return value;
};

const config = {
  // Application & Runtime
  app: {
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 8000,
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [],
    baseDomain: process.env.BASE_DOMAIN || 'localhost',
  },

  // Database
  database: {
    url: process.env.DATABASE_URL || 'mongodb://localhost:27017/electronics',
  },

  // Security & Authentication
  security: {
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 12,
  },

  jwt: {
    accessSecret: requireSecret('JWT_ACCESS_SECRET', 'insecure-dev-access-secret'),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1d',
    refreshSecret: requireSecret('JWT_REFRESH_SECRET', 'insecure-dev-refresh-secret'),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    resetSecret: requireSecret('RESET_PASS_TOKEN_SECRET', 'insecure-dev-reset-pass-secret'),
    resetExpiresIn: process.env.RESET_PASS_TOKEN_EXPIRES_IN || '10m',
  },

  // Super Admin Bootstrap Credentials
  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || 'admin@famouselectronics.com',
    password: requireSecret('SUPER_ADMIN_PASSWORD', 'insecure-dev-password'),
  },

  // Cloudinary Media Storage
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },

  // Storefront Integration
  storefront: {
    apiKey: process.env.STOREFRONT_API_KEY || '',
  },

  // Mailer (SMTP)
  mail: {
    host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.BREVO_SMTP_PORT) || 587,
    user: process.env.BREVO_SMTP_USER || '',
    pass: process.env.BREVO_SMTP_PASS || '',
    from: process.env.BREVO_SMTP_FROM || 'contact@famouselectronics.com',
  },

  // Cloudflare
  cloudflare: {
    zoneId: process.env.CLOUDFLARE_ZONE_ID || '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
  },
} as const;

export type Config = typeof config;
export default config;
