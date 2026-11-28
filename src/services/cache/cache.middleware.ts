import { Request, Response, NextFunction } from 'express';
import { CacheGroup } from '../../infrastructure/redis/redis.metrics';
import { CacheService } from './cache.service';

export interface CacheMiddlewareOptions {
  group: CacheGroup;
  ttlSeconds: number;
  keyBuilder: (req: Request) => string | Promise<string>;
  shouldCache?: (req: Request, body: unknown) => boolean;
}

/**
 * Reusable GET-only API response caching middleware.
 * - Preserves exact API response format & status code (200)
 * - Never caches non-2xx responses or bypass requests (`?nocache=1` / `x-cache-bypass: true` for admins)
 * - Tags `res.locals.cacheStatus` ('HIT' | 'MISS' | 'BYPASS') for API performance monitoring
 */
export const cacheResponse = (options: CacheMiddlewareOptions) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      res.locals.cacheStatus = 'BYPASS';
      return next();
    }

    if (req.headers['x-cache-bypass'] === 'true' || req.query.nocache === 'true') {
      res.locals.cacheStatus = 'BYPASS';
      res.setHeader('X-Cache', 'BYPASS');
      return next();
    }

    try {
      const cacheKey = await options.keyBuilder(req);
      const cached = await CacheService.get<{ statusCode: number; body: unknown }>(cacheKey, {
        group: options.group,
      });

      if (cached && cached.body !== undefined) {
        res.locals.cacheStatus = 'HIT';
        res.setHeader('X-Cache', 'HIT');
        return res.status(cached.statusCode || 200).json(cached.body);
      }

      res.locals.cacheStatus = 'MISS';
      res.setHeader('X-Cache', 'MISS');

      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (
          res.statusCode >= 200 &&
          res.statusCode < 300 &&
          (!options.shouldCache || options.shouldCache(req, body))
        ) {
          void CacheService.set(
            cacheKey,
            { statusCode: res.statusCode, body },
            { group: options.group, ttlSeconds: options.ttlSeconds }
          );
        }
        return originalJson(body);
      }) as typeof res.json;

      return next();
    } catch {
      res.locals.cacheStatus = 'BYPASS';
      return next();
    }
  };
};
