import crypto from 'crypto';

const sanitizeSegment = (raw: string, maxLen = 64): string => {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .slice(0, maxLen) || 'none';
};

export const hashObject = (obj: Record<string, unknown>): string => {
  const sortedEntries = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .map((k) => [k, obj[k]]);
  const serialized = JSON.stringify(sortedEntries);
  return crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 16);
};

export const normalizeSearchTerm = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64);
  return normalized || undefined;
};

export const CacheKeys = {
  // Version counters for O(1) bulk invalidation of paginated store keys
  storeProductVersion: (storeId: string) => `store:${sanitizeSegment(storeId)}:ver:products`,
  storeCategoryVersion: (storeId: string) => `store:${sanitizeSegment(storeId)}:ver:categories`,

  // Tenant / Storefront resolution & settings
  tenantLookup: (hostOrSlug: string) =>
    `tenant:lookup:${hashObject({ host: String(hostOrSlug).replace(/^www\./, '').toLowerCase().trim() })}`,
  corsCustomDomain: (host: string) =>
    `tenant:cors:${sanitizeSegment(host.replace(/^www\./, ''), 100)}`,
  storeStatus: (storeId: string) => `store:${sanitizeSegment(storeId)}:status`,
  storeSubscription: (storeId: string) => `store:${sanitizeSegment(storeId)}:subscription`,
  storeInfo: (storeIdOrSlug: string) => `store:${sanitizeSegment(storeIdOrSlug)}:settings:info`,
  storeTheme: (storeId: string) => `store:${sanitizeSegment(storeId)}:settings:theme`,
  platformPublicSettings: () => `platform:public-settings`,
  authMerchantContext: (userId: string, tenantId?: string) =>
    `auth:merchant:${sanitizeSegment(userId)}:${sanitizeSegment(tenantId || 'owner')}`,

  // Categories (multi-tenant isolated)
  storeActiveCategoryIds: (storeId: string) =>
    `store:${sanitizeSegment(storeId)}:categories:active-ids`,
  storeCategoriesAll: (storeId: string, ver = 1) =>
    `store:${sanitizeSegment(storeId)}:categories:v${ver}:all`,
  storeCategoriesList: (storeId: string, ver: number, query: Record<string, unknown>) =>
    `store:${sanitizeSegment(storeId)}:categories:v${ver}:list:${hashObject(query)}`,
  storeCategoryById: (storeId: string, categoryId: string) =>
    `store:${sanitizeSegment(storeId)}:category:${sanitizeSegment(categoryId)}`,

  // Products (multi-tenant isolated, versioned for listings)
  storeProductsList: (
    storeId: string,
    ver: number,
    params: {
      page?: unknown;
      limit?: unknown;
      sort?: unknown;
      categoryId?: unknown;
      minPrice?: unknown;
      maxPrice?: unknown;
      inStock?: unknown;
      brand?: unknown;
      search?: unknown;
      status?: unknown;
    }
  ) => {
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;
    const sort = sanitizeSegment(String(params.sort || 'default'), 32);
    const filterHash = hashObject({
      categoryId: params.categoryId ? String(params.categoryId).trim() : undefined,
      minPrice: params.minPrice !== undefined ? Number(params.minPrice) : undefined,
      maxPrice: params.maxPrice !== undefined ? Number(params.maxPrice) : undefined,
      inStock: params.inStock ? String(params.inStock) : undefined,
      brand: params.brand ? String(params.brand).trim().toLowerCase().slice(0, 50) : undefined,
      search: normalizeSearchTerm(params.search),
      status: params.status ? String(params.status) : undefined,
    });
    return `store:${sanitizeSegment(storeId)}:products:v${ver}:page:${page}:limit:${limit}:sort:${sort}:filter:${filterHash}`;
  },
  storeBestsellers: (storeId: string, ver: number, limit: number) =>
    `store:${sanitizeSegment(storeId)}:products:v${ver}:bestsellers:${limit}`,
  storeNewArrivals: (storeId: string, ver: number, limit: number) =>
    `store:${sanitizeSegment(storeId)}:products:v${ver}:new-arrivals:${limit}`,
  storeBrands: (storeId: string, ver: number, categoryId?: string) =>
    `store:${sanitizeSegment(storeId)}:products:v${ver}:brands:${sanitizeSegment(categoryId || 'all')}`,
  storeProductById: (storeId: string, productId: string) =>
    `store:${sanitizeSegment(storeId)}:product:id:${sanitizeSegment(productId)}`,
  storeProductBySlug: (storeId: string, slug: string) =>
    `store:${sanitizeSegment(storeId)}:product:slug:${hashObject({ slug: slug.trim() })}`,

  // Dashboards (role & tenant/affiliate isolated)
  merchantDashboardSummary: (merchantStoreId: string, days: number) =>
    `merchant:${sanitizeSegment(merchantStoreId)}:dashboard:summary:days:${days}`,
  merchantDashboardStats: (merchantStoreId: string, days: number) =>
    `merchant:${sanitizeSegment(merchantStoreId)}:dashboard:stats:days:${days}`,
  merchantAnalytics: (merchantStoreId: string, section: string, query: Record<string, unknown>) =>
    `merchant:${sanitizeSegment(merchantStoreId)}:analytics:${sanitizeSegment(section)}:${hashObject(query)}`,

  adminDashboardSuperStats: () => `admin:dashboard:super-stats`,
  adminDashboardOverview: (query: Record<string, unknown>) =>
    `admin:dashboard:overview:${hashObject(query)}`,
  adminDashboardMerchants: (query: Record<string, unknown>) =>
    `admin:dashboard:merchants:${hashObject(query)}`,
  adminAffiliateOverview: () => `admin:affiliates:overview`,
  publicPlatformStats: () => `platform:public-stats`,

  affiliatePublicConfig: () => `affiliate:public-config`,
  affiliateDashboardOverview: (affiliateId: string, query: Record<string, unknown>) =>
    `affiliate:${sanitizeSegment(affiliateId)}:dashboard:summary:${hashObject(query)}`,
} as const;
