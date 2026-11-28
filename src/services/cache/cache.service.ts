import { redisConfig } from '../../config/redis.config';
import { getRedisClient, withRedisTimeout } from '../../infrastructure/redis/redis.client';
import {
  CacheGroup,
  recordCacheError,
  recordCacheHit,
  recordCacheMiss,
  recordCacheSet,
} from '../../infrastructure/redis/redis.metrics';
import { withStampedeProtection } from './cache.lock';
import { CACHE_TTL, withJitter } from './cache.ttl';

export interface CacheGetOptions {
  group?: CacheGroup | undefined;
  silent?: boolean | undefined;
}

export interface CacheSetOptions {
  group?: CacheGroup | undefined;
  ttlSeconds?: number | undefined;
  jitter?: boolean | undefined;
}

export interface CacheOrSetOptions<T> {
  group?: CacheGroup | undefined;
  ttlSeconds?: number | undefined;
  jitter?: boolean | undefined;
  stampedeProtection?: boolean | undefined;
  shouldCache?: ((value: T) => boolean) | undefined;
}

export const CacheService = {
  async get<T>(key: string, options: CacheGetOptions = {}): Promise<T | null> {
    const group = options.group || 'other';
    const raw = await withRedisTimeout<string | null>(
      async (client) => client.get(key),
      null
    );

    if (raw === null) {
      if (!options.silent) recordCacheMiss(group);
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as T;
      if (!options.silent) recordCacheHit(group);
      return parsed;
    } catch {
      // Corrupt JSON in cache — delete and fail open
      if (!options.silent) recordCacheError(group);
      await this.del(key);
      return null;
    }
  },

  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<boolean> {
    const group = options.group || 'other';
    const client = getRedisClient();
    if (!client) return false;

    try {
      const serialized = JSON.stringify(value);
      if (Buffer.byteLength(serialized, 'utf8') > redisConfig.maxPayloadBytes) {
        // Protect 128 MB Redis budget from oversized documents
        return false;
      }

      const baseTtl = options.ttlSeconds ?? CACHE_TTL.DEFAULT;
      const finalTtl = options.jitter === false ? Math.max(1, Math.floor(baseTtl)) : withJitter(baseTtl);

      const ok = await withRedisTimeout<boolean>(async (c) => {
        await c.set(key, serialized, { EX: finalTtl });
        return true;
      }, false);

      if (ok) recordCacheSet(group);
      return ok;
    } catch {
      recordCacheError(group);
      return false;
    }
  },

  async del(key: string): Promise<boolean> {
    return withRedisTimeout<boolean>(async (client) => {
      await client.del(key);
      return true;
    }, false);
  },

  async delMany(keys: string[]): Promise<number> {
    if (!keys.length) return 0;
    return withRedisTimeout<number>(async (client) => {
      return await client.del(keys);
    }, 0);
  },

  /**
   * Reads an integer version counter for O(1) store listing invalidation.
   */
  async getVersion(versionKey: string): Promise<number> {
    const val = await withRedisTimeout<string | null>(
      async (client) => client.get(versionKey),
      null
    );
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 1;
  },

  /**
   * Increments an integer version counter in O(1), invalidating all derived keys.
   */
  async bumpVersion(versionKey: string): Promise<number> {
    return withRedisTimeout<number>(async (client) => {
      const next = await client.incr(versionKey);
      // Keep version key around for 7 days so it eventually cleans up for inactive stores
      await client.expire(versionKey, 7 * 24 * 60 * 60);
      return next;
    }, 1);
  },

  /**
   * Cache-aside helper with optional stampede protection & fail-open DB fallback.
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOrSetOptions<T> = {}
  ): Promise<{ value: T; hit: boolean }> {
    const group = options.group || 'other';
    const cached = await this.get<T>(key, { group });
    if (cached !== null) {
      return { value: cached, hit: true };
    }

    const executeFetch = async () => {
      const fresh = await fetcher();
      const allowCache = options.shouldCache ? options.shouldCache(fresh) : fresh !== undefined;
      if (allowCache) {
        await this.set(key, fresh, {
          group,
          ttlSeconds: options.ttlSeconds,
          jitter: options.jitter,
        });
      }
      return fresh;
    };

    const value = options.stampedeProtection === false
      ? await executeFetch()
      : await withStampedeProtection(key, executeFetch);

    return { value, hit: false };
  },
};
