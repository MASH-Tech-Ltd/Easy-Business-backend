import { Request, Response, NextFunction } from 'express';
import { redisConfig } from '../../config/redis.config';

export type CacheGroup =
  | 'product'
  | 'category'
  | 'storefront'
  | 'merchant_dashboard'
  | 'admin_dashboard'
  | 'affiliate_dashboard'
  | 'auth_tenant'
  | 'other';

interface GroupMetrics {
  hits: number;
  misses: number;
  sets: number;
  invalidations: number;
  errors: number;
  lastAccessAt: string | null;
}

interface EndpointMetric {
  key: string;
  method: string;
  endpoint: string;
  requestCount: number;
  totalLatencyMs: number;
  hitCount: number;
  hitTotalLatencyMs: number;
  missCount: number;
  missTotalLatencyMs: number;
  slowCount: number;
  latencies: number[];
  lastCalledAt: string;
}

const MAX_LATENCY_SAMPLES = 200;
const MAX_TRACKED_ENDPOINTS = 250;

const createEmptyGroup = (): GroupMetrics => ({
  hits: 0,
  misses: 0,
  sets: 0,
  invalidations: 0,
  errors: 0,
  lastAccessAt: null,
});

const groupStats = new Map<CacheGroup, GroupMetrics>([
  ['product', createEmptyGroup()],
  ['category', createEmptyGroup()],
  ['storefront', createEmptyGroup()],
  ['merchant_dashboard', createEmptyGroup()],
  ['admin_dashboard', createEmptyGroup()],
  ['affiliate_dashboard', createEmptyGroup()],
  ['auth_tenant', createEmptyGroup()],
  ['other', createEmptyGroup()],
]);

const endpointStats = new Map<string, EndpointMetric>();
const startedAt = new Date();

let totalGets = 0;
let totalSets = 0;
let totalInvalidations = 0;
let totalErrors = 0;

const getGroup = (group: CacheGroup): GroupMetrics => {
  let entry = groupStats.get(group);
  if (!entry) {
    entry = createEmptyGroup();
    groupStats.set(group, entry);
  }
  return entry;
};

export const recordCacheHit = (group: CacheGroup): void => {
  totalGets++;
  const entry = getGroup(group);
  entry.hits++;
  entry.lastAccessAt = new Date().toISOString();
};

export const recordCacheMiss = (group: CacheGroup): void => {
  totalGets++;
  const entry = getGroup(group);
  entry.misses++;
  entry.lastAccessAt = new Date().toISOString();
};

export const recordCacheSet = (group: CacheGroup): void => {
  totalSets++;
  const entry = getGroup(group);
  entry.sets++;
  entry.lastAccessAt = new Date().toISOString();
};

export const recordCacheInvalidation = (group: CacheGroup, count = 1): void => {
  totalInvalidations += count;
  const entry = getGroup(group);
  entry.invalidations += count;
};

export const recordCacheError = (group: CacheGroup): void => {
  totalErrors++;
  const entry = getGroup(group);
  entry.errors++;
};

/**
 * Normalizes dynamic IDs/slugs in URLs so aggregated API metrics don't explode
 * into thousands of per-tenant or per-product keys.
 */
const normalizeEndpointPath = (req: Request): string => {
  const fullPath = `${req.baseUrl || ''}${req.route?.path || req.path || ''}`.split('?')[0] || req.originalUrl.split('?')[0] || '/';
  return fullPath
    .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, '/:id')
    .replace(/\/storefront\/[^/]+/g, '/storefront/:tenantSlug')
    .replace(/\/products\/[^/]+$/g, '/products/:slug');
};

const computeP95 = (samples: number[]): number => {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Number((sorted[idx] ?? 0).toFixed(2));
};

/**
 * Express middleware that records application-level API response time and
 * compares cache-hit vs cache-miss latency.
 */
export const apiPerformanceMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!redisConfig.monitoring.enabled || !req.originalUrl.startsWith('/api/v1')) {
    return next();
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const endpoint = normalizeEndpointPath(req);
    const key = `${req.method} ${endpoint}`;
    const cacheStatus = (res.locals?.cacheStatus as 'HIT' | 'MISS' | 'BYPASS' | undefined) || undefined;

    let entry = endpointStats.get(key);
    if (!entry) {
      if (endpointStats.size >= MAX_TRACKED_ENDPOINTS) {
        const oldestKey = endpointStats.keys().next().value;
        if (oldestKey) endpointStats.delete(oldestKey);
      }
      entry = {
        key,
        method: req.method,
        endpoint,
        requestCount: 0,
        totalLatencyMs: 0,
        hitCount: 0,
        hitTotalLatencyMs: 0,
        missCount: 0,
        missTotalLatencyMs: 0,
        slowCount: 0,
        latencies: [],
        lastCalledAt: new Date().toISOString(),
      };
      endpointStats.set(key, entry);
    }

    entry.requestCount++;
    entry.totalLatencyMs += durationMs;
    entry.lastCalledAt = new Date().toISOString();

    if (durationMs >= redisConfig.monitoring.slowEndpointThresholdMs) {
      entry.slowCount++;
    }

    if (cacheStatus === 'HIT') {
      entry.hitCount++;
      entry.hitTotalLatencyMs += durationMs;
    } else if (cacheStatus === 'MISS') {
      entry.missCount++;
      entry.missTotalLatencyMs += durationMs;
    }

    if (entry.latencies.length >= MAX_LATENCY_SAMPLES) {
      entry.latencies.shift();
    }
    entry.latencies.push(durationMs);
  });

  next();
};

export const getCacheAnalyticsSnapshot = () => {
  let totalHits = 0;
  let totalMisses = 0;

  const groups = Array.from(groupStats.entries()).map(([group, stats]) => {
    totalHits += stats.hits;
    totalMisses += stats.misses;
    const total = stats.hits + stats.misses;
    const hitRate = total > 0 ? Number(((stats.hits / total) * 100).toFixed(2)) : 0;
    return {
      group,
      ...stats,
      totalLookups: total,
      hitRatePercent: hitRate,
      missRatePercent: total > 0 ? Number((100 - hitRate).toFixed(2)) : 0,
    };
  });

  const totalLookups = totalHits + totalMisses;
  const hitRatePercent = totalLookups > 0 ? Number(((totalHits / totalLookups) * 100).toFixed(2)) : 0;

  return {
    since: startedAt.toISOString(),
    totals: {
      hits: totalHits,
      misses: totalMisses,
      totalLookups,
      hitRatePercent,
      missRatePercent: totalLookups > 0 ? Number((100 - hitRatePercent).toFixed(2)) : 0,
      gets: totalGets,
      sets: totalSets,
      invalidations: totalInvalidations,
      errors: totalErrors,
    },
    groups: groups.sort((a, b) => b.totalLookups - a.totalLookups),
  };
};

export const getApiPerformanceSnapshot = () => {
  const endpoints = Array.from(endpointStats.values()).map((ep) => ({
    method: ep.method,
    endpoint: ep.endpoint,
    requestCount: ep.requestCount,
    avgResponseTimeMs: ep.requestCount > 0 ? Number((ep.totalLatencyMs / ep.requestCount).toFixed(2)) : 0,
    p95ResponseTimeMs: computeP95(ep.latencies),
    cacheHitCount: ep.hitCount,
    cacheMissCount: ep.missCount,
    avgHitLatencyMs: ep.hitCount > 0 ? Number((ep.hitTotalLatencyMs / ep.hitCount).toFixed(2)) : null,
    avgMissLatencyMs: ep.missCount > 0 ? Number((ep.missTotalLatencyMs / ep.missCount).toFixed(2)) : null,
    slowCount: ep.slowCount,
    lastCalledAt: ep.lastCalledAt,
  }));

  return {
    since: startedAt.toISOString(),
    slowThresholdMs: redisConfig.monitoring.slowEndpointThresholdMs,
    endpoints: endpoints.sort((a, b) => b.requestCount - a.requestCount),
    slowEndpoints: [...endpoints]
      .filter((e) => e.p95ResponseTimeMs >= redisConfig.monitoring.slowEndpointThresholdMs || e.slowCount > 0)
      .sort((a, b) => b.p95ResponseTimeMs - a.p95ResponseTimeMs)
      .slice(0, 15),
  };
};
