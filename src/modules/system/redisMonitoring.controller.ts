import { Request, Response } from 'express';
import mongoose from 'mongoose';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { getRedisInfoSnapshot, pingRedis } from '../../infrastructure/redis/redis.health';
import {
  getApiPerformanceSnapshot,
  getCacheAnalyticsSnapshot,
} from '../../infrastructure/redis/redis.metrics';
import { CacheInvalidation } from '../../services/cache/cache.invalidation';
import { SecurityLog } from './security.model';
import { getClientIp } from '../../utils/ipHelper';

const ALLOWED_GROUPS = new Set([
  'product',
  'category',
  'storefront',
  'merchant_dashboard',
  'admin_dashboard',
  'affiliate_dashboard',
  'auth_tenant',
]);

const recordAdminCacheAudit = async (req: Request, action: string, details: string) => {
  try {
    await SecurityLog.create({
      incidentType: 'ADMIN_CACHE_ACTION',
      endpoint: req.originalUrl,
      ipAddress: getClientIp(req),
      reason: `${action}: ${details}`,
      requestedFrom: 'super_admin_dashboard',
      userAgent: req.headers['user-agent'] || 'Unknown',
    });
  } catch {
    // Non-blocking audit log
  }
};

const getOverview = asyncHandler(async (_req: Request, res: Response) => {
  const [redisInfo, ping, analytics] = await Promise.all([
    getRedisInfoSnapshot(),
    pingRedis(),
    Promise.resolve(getCacheAnalyticsSnapshot()),
  ]);

  ApiResponse.sendSuccess(res, 200, 'Redis overview retrieved', {
    redis: redisInfo,
    ping,
    appCache: analytics.totals,
  });
});

const getMemory = asyncHandler(async (_req: Request, res: Response) => {
  const redisInfo = await getRedisInfoSnapshot();
  ApiResponse.sendSuccess(res, 200, 'Redis memory metrics retrieved', {
    connected: redisInfo.connected,
    memory: redisInfo.memory,
    totalKeys: redisInfo.totalKeys,
    checkedAt: redisInfo.checkedAt,
  });
});

const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const [redisInfo, analytics] = await Promise.all([
    getRedisInfoSnapshot(),
    Promise.resolve(getCacheAnalyticsSnapshot()),
  ]);

  ApiResponse.sendSuccess(res, 200, 'Redis cache stats retrieved', {
    connected: redisInfo.connected,
    redisStats: redisInfo.stats,
    appTotals: analytics.totals,
    since: analytics.since,
  });
});

const getCacheAnalytics = asyncHandler(async (_req: Request, res: Response) => {
  const analytics = getCacheAnalyticsSnapshot();
  ApiResponse.sendSuccess(res, 200, 'Cache group analytics retrieved', analytics);
});

const getApiPerformance = asyncHandler(async (_req: Request, res: Response) => {
  const perf = getApiPerformanceSnapshot();
  ApiResponse.sendSuccess(res, 200, 'API performance metrics retrieved', perf);
});

const getTopEndpoints = asyncHandler(async (_req: Request, res: Response) => {
  const perf = getApiPerformanceSnapshot();
  ApiResponse.sendSuccess(res, 200, 'Top API endpoints retrieved', {
    since: perf.since,
    slowThresholdMs: perf.slowThresholdMs,
    topEndpoints: perf.endpoints.slice(0, 15),
    slowEndpoints: perf.slowEndpoints,
  });
});

const getHealth = asyncHandler(async (_req: Request, res: Response) => {
  const [ping, info] = await Promise.all([pingRedis(), getRedisInfoSnapshot()]);
  ApiResponse.sendSuccess(res, 200, 'Redis health retrieved', {
    enabled: info.enabled,
    connected: info.connected,
    status: info.status,
    latencyMs: ping.latencyMs,
    failOpenActive: !info.connected,
    lastError: info.lastError,
    checkedAt: info.checkedAt,
  });
});

const clearAllCache = asyncHandler(async (req: Request, res: Response) => {
  const ok = await CacheInvalidation.clearAllCache();
  await recordAdminCacheAudit(req, 'CLEAR_ALL_CACHE', ok ? 'Flushed Redis DB' : 'Redis unavailable');
  ApiResponse.sendSuccess(res, 200, ok ? 'All Redis cache cleared successfully' : 'Redis unavailable; no cache cleared', {
    cleared: ok,
  });
});

const clearCacheGroup = asyncHandler(async (req: Request, res: Response) => {
  const group = String(req.body?.group || '').trim();
  if (!ALLOWED_GROUPS.has(group)) {
    return ApiResponse.sendError(
      res,
      400,
      `Invalid cache group. Allowed groups: ${Array.from(ALLOWED_GROUPS).join(', ')}`
    );
  }

  const deletedCount = await CacheInvalidation.clearCacheGroup(group as any);
  await recordAdminCacheAudit(req, 'CLEAR_CACHE_GROUP', `group=${group}, deletedKeys=${deletedCount}`);
  ApiResponse.sendSuccess(res, 200, `Cleared ${group} cache (${deletedCount} keys removed)`, {
    group,
    deletedCount,
  });
});

const clearStoreCache = asyncHandler(async (req: Request, res: Response) => {
  const storeId = String(req.body?.storeId || '').trim();
  if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
    return ApiResponse.sendError(res, 400, 'Valid storeId (ObjectId) is required');
  }

  const deletedCount = await CacheInvalidation.clearStoreCache(storeId);
  await recordAdminCacheAudit(req, 'CLEAR_STORE_CACHE', `storeId=${storeId}, deletedKeys=${deletedCount}`);
  ApiResponse.sendSuccess(res, 200, `Cleared store cache (${deletedCount} keys removed)`, {
    storeId,
    deletedCount,
  });
});

export const RedisMonitoringController = {
  getOverview,
  getMemory,
  getStats,
  getCacheAnalytics,
  getApiPerformance,
  getTopEndpoints,
  getHealth,
  clearAllCache,
  clearCacheGroup,
  clearStoreCache,
};
