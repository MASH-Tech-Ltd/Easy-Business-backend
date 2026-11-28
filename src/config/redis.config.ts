import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const parsePositiveInt = (raw: string | undefined, fallback: number, min = 1): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
};

export const redisConfig = {
  enabled: process.env.REDIS_ENABLED !== 'false',
  host: (process.env.REDIS_HOST || '127.0.0.2').trim(),
  port: parsePositiveInt(process.env.REDIS_PORT, 6379),
  password: process.env.REDIS_PASSWORD?.trim() || undefined,
  db: parsePositiveInt(process.env.REDIS_DB, 0, 0),
  maxRetries: parsePositiveInt(process.env.REDIS_MAX_RETRIES, 3),
  connectTimeoutMs: parsePositiveInt(process.env.REDIS_CONNECT_TIMEOUT, 3000, 200),
  commandTimeoutMs: parsePositiveInt(process.env.REDIS_COMMAND_TIMEOUT, 1000, 100),
  maxMemoryMb: parsePositiveInt(process.env.REDIS_MAXMEMORY_MB, 128, 16),
  maxPayloadBytes: parsePositiveInt(process.env.CACHE_MAX_PAYLOAD_BYTES, 256 * 1024, 1024),

  ttl: {
    default: parsePositiveInt(process.env.CACHE_DEFAULT_TTL, 300),
    productListing: parsePositiveInt(process.env.CACHE_PRODUCT_TTL, 120),
    productDetail: parsePositiveInt(process.env.CACHE_PRODUCT_DETAIL_TTL, 300),
    productFeatured: parsePositiveInt(process.env.CACHE_PRODUCT_FEATURED_TTL, 180),
    productSearch: parsePositiveInt(process.env.CACHE_PRODUCT_SEARCH_TTL, 60),
    categoryAll: parsePositiveInt(process.env.CACHE_CATEGORY_TTL, 900),
    categoryDetail: parsePositiveInt(process.env.CACHE_CATEGORY_DETAIL_TTL, 600),
    categoryCounts: parsePositiveInt(process.env.CACHE_CATEGORY_COUNTS_TTL, 120),
    storeSettings: parsePositiveInt(process.env.CACHE_STORE_SETTINGS_TTL, 900),
    storeStatus: parsePositiveInt(process.env.CACHE_STORE_STATUS_TTL, 60),
    dashboard: parsePositiveInt(process.env.CACHE_DASHBOARD_TTL, 60),
    authContext: parsePositiveInt(process.env.CACHE_AUTH_CONTEXT_TTL, 45),
  },

  monitoring: {
    enabled: process.env.REDIS_MONITORING_ENABLED !== 'false',
    intervalMs: parsePositiveInt(process.env.REDIS_MONITORING_INTERVAL, 15000, 5000),
    slowEndpointThresholdMs: parsePositiveInt(process.env.API_SLOW_THRESHOLD_MS, 300, 50),
  },
} as const;

export type RedisConfig = typeof redisConfig;
