import { getRedisClient, withRedisTimeout } from '../../infrastructure/redis/redis.client';
import { CacheGroup, recordCacheInvalidation } from '../../infrastructure/redis/redis.metrics';
import { CacheKeys } from './cache.keys';
import { CacheService } from './cache.service';

/**
 * Safely deletes keys matching a prefix using SCAN (never KEYS *).
 * Used only for targeted admin/store clears, never on hot request paths.
 */
const scanAndDeletePrefix = async (pattern: string, group: CacheGroup = 'other'): Promise<number> => {
  const client = getRedisClient();
  if (!client) return 0;

  let deleted = 0;
  try {
    let cursor = '0';
    let iterations = 0;
    const maxIterations = 200; // Safety bound

    do {
      const reply = await client.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });
      cursor = String(reply.cursor);
      if (reply.keys.length > 0) {
        deleted += await client.del(reply.keys);
      }
      iterations++;
    } while (cursor !== '0' && iterations < maxIterations);

    if (deleted > 0) {
      recordCacheInvalidation(group, deleted);
    }
  } catch {
    // Fail open
  }
  return deleted;
};

export const CacheInvalidation = {
  async invalidateProductListings(storeId: string): Promise<void> {
    if (!storeId) return;
    await CacheService.bumpVersion(CacheKeys.storeProductVersion(storeId));
    recordCacheInvalidation('product', 1);
  },

  async invalidateProduct(storeId: string, productId?: string, slug?: string): Promise<void> {
    if (!storeId) return;
    const keys: string[] = [];
    if (productId) keys.push(CacheKeys.storeProductById(storeId, productId));
    if (slug) keys.push(CacheKeys.storeProductBySlug(storeId, slug));
    await Promise.all([
      keys.length ? CacheService.delMany(keys) : Promise.resolve(0),
      CacheService.bumpVersion(CacheKeys.storeProductVersion(storeId)),
    ]);
    recordCacheInvalidation('product', keys.length + 1);
  },

  async invalidateCategory(storeId: string, categoryId?: string): Promise<void> {
    if (!storeId) return;
    const keys: string[] = [CacheKeys.storeActiveCategoryIds(storeId)];
    if (categoryId) keys.push(CacheKeys.storeCategoryById(storeId, categoryId));
    await Promise.all([
      CacheService.delMany(keys),
      CacheService.bumpVersion(CacheKeys.storeCategoryVersion(storeId)),
      // Category status/name changes also affect storefront product listings & active category filters
      CacheService.bumpVersion(CacheKeys.storeProductVersion(storeId)),
    ]);
    recordCacheInvalidation('category', keys.length + 2);
  },

  async invalidateStoreHomepage(storeId: string): Promise<void> {
    if (!storeId) return;
    await Promise.all([
      CacheService.bumpVersion(CacheKeys.storeProductVersion(storeId)),
      CacheService.bumpVersion(CacheKeys.storeCategoryVersion(storeId)),
      CacheService.delMany([
        CacheKeys.storeTheme(storeId),
        CacheKeys.storeInfo(storeId),
        CacheKeys.storeActiveCategoryIds(storeId),
      ]),
    ]);
    recordCacheInvalidation('storefront', 3);
  },

  async invalidateStoreSettings(storeId: string, slugOrHosts: string[] = []): Promise<void> {
    if (!storeId) return;
    const keys: string[] = [
      CacheKeys.storeTheme(storeId),
      CacheKeys.storeInfo(storeId),
      CacheKeys.storeStatus(storeId),
      CacheKeys.storeSubscription(storeId),
    ];
    for (const host of slugOrHosts) {
      if (host) {
        keys.push(CacheKeys.tenantLookup(host));
        keys.push(CacheKeys.corsCustomDomain(host));
        keys.push(CacheKeys.storeInfo(host));
      }
    }
    await CacheService.delMany(keys);
    recordCacheInvalidation('storefront', keys.length);
  },

  async invalidateMerchantDashboard(storeId: string): Promise<void> {
    if (!storeId) return;
    await scanAndDeletePrefix(`merchant:${storeId.toLowerCase()}:*`, 'merchant_dashboard');
  },

  async invalidateAdminDashboard(): Promise<void> {
    const keys = [
      CacheKeys.adminDashboardSuperStats(),
      CacheKeys.adminAffiliateOverview(),
      CacheKeys.publicPlatformStats(),
    ];
    await Promise.all([
      CacheService.delMany(keys),
      scanAndDeletePrefix('admin:dashboard:*', 'admin_dashboard'),
    ]);
    recordCacheInvalidation('admin_dashboard', keys.length);
  },

  async invalidateAffiliateDashboard(affiliateId?: string): Promise<void> {
    const promises: Promise<unknown>[] = [
      CacheService.delMany([CacheKeys.affiliatePublicConfig(), CacheKeys.adminAffiliateOverview()]),
    ];
    if (affiliateId) {
      promises.push(scanAndDeletePrefix(`affiliate:${affiliateId.toLowerCase()}:*`, 'affiliate_dashboard'));
    } else {
      promises.push(scanAndDeletePrefix('affiliate:*', 'affiliate_dashboard'));
    }
    await Promise.all(promises);
    recordCacheInvalidation('affiliate_dashboard', 1);
  },

  async clearStoreCache(storeId: string): Promise<number> {
    if (!storeId) return 0;
    const sid = storeId.toLowerCase();
    const [a, b] = await Promise.all([
      scanAndDeletePrefix(`store:${sid}:*`, 'storefront'),
      scanAndDeletePrefix(`merchant:${sid}:*`, 'merchant_dashboard'),
    ]);
    return a + b;
  },

  async clearCacheGroup(
    group: 'product' | 'category' | 'storefront' | 'merchant_dashboard' | 'admin_dashboard' | 'affiliate_dashboard' | 'auth_tenant'
  ): Promise<number> {
    switch (group) {
      case 'product':
        return scanAndDeletePrefix('store:*:product*', 'product');
      case 'category':
        return scanAndDeletePrefix('store:*:categor*', 'category');
      case 'storefront':
        return scanAndDeletePrefix('store:*', 'storefront');
      case 'merchant_dashboard':
        return scanAndDeletePrefix('merchant:*', 'merchant_dashboard');
      case 'admin_dashboard':
        return scanAndDeletePrefix('admin:*', 'admin_dashboard');
      case 'affiliate_dashboard':
        return scanAndDeletePrefix('affiliate:*', 'affiliate_dashboard');
      case 'auth_tenant': {
        const [a, b] = await Promise.all([
          scanAndDeletePrefix('auth:*', 'auth_tenant'),
          scanAndDeletePrefix('tenant:*', 'auth_tenant'),
        ]);
        return a + b;
      }
      default:
        return 0;
    }
  },

  async clearAllCache(): Promise<boolean> {
    const ok = await withRedisTimeout<boolean>(async (client) => {
      await client.flushDb();
      return true;
    }, false);
    if (ok) recordCacheInvalidation('other', 1);
    return ok;
  },
};
