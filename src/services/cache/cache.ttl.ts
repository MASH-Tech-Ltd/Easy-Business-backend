import { redisConfig } from '../../config/redis.config';

export const CACHE_TTL = {
  DEFAULT: redisConfig.ttl.default,
  PRODUCT_LISTING: redisConfig.ttl.productListing,
  PRODUCT_DETAIL: redisConfig.ttl.productDetail,
  PRODUCT_FEATURED: redisConfig.ttl.productFeatured,
  PRODUCT_SEARCH: redisConfig.ttl.productSearch,
  CATEGORY_ALL: redisConfig.ttl.categoryAll,
  CATEGORY_DETAIL: redisConfig.ttl.categoryDetail,
  CATEGORY_COUNTS: redisConfig.ttl.categoryCounts,
  STORE_SETTINGS: redisConfig.ttl.storeSettings,
  STORE_STATUS: redisConfig.ttl.storeStatus,
  DASHBOARD: redisConfig.ttl.dashboard,
  AUTH_CONTEXT: redisConfig.ttl.authContext,
} as const;

/**
 * Adds +/- 10% jitter to TTL (minimum 5s) to prevent synchronized cache expiration
 * across many keys created at the same time.
 */
export const withJitter = (ttlSeconds: number, jitterRatio = 0.1): number => {
  if (ttlSeconds <= 5) return Math.max(1, Math.floor(ttlSeconds));
  const spread = Math.max(1, Math.floor(ttlSeconds * jitterRatio));
  const delta = Math.floor(Math.random() * (spread * 2 + 1)) - spread;
  return Math.max(5, ttlSeconds + delta);
};
