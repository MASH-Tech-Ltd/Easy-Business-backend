import { Store, IncrementResponse } from 'express-rate-limit';
import { getRedisClient, isRedisReady, withRedisTimeout } from './redis.client';

const INCREMENT_LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local pttl = redis.call("PTTL", KEYS[1])
return { current, pttl }
`;

/**
 * Redis-backed Store for express-rate-limit with automatic fallback
 * to an in-memory Store when Redis is unavailable (fail-open).
 */
export class RedisRateLimitStore implements Store {
  readonly prefix: string;
  private readonly fallbackStore: Store;
  private windowMs = 60_000;

  constructor(prefix: string, fallbackStore: Store) {
    this.prefix = prefix;
    this.fallbackStore = fallbackStore;
  }

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
    this.fallbackStore.init?.(options as any);
  }

  private formatKey(key: string): string {
    return `rl:${this.prefix}:${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const client = getRedisClient();
    if (!client || !isRedisReady()) {
      return this.fallbackStore.increment(key);
    }

    const redisKey = this.formatKey(key);
    const res = await withRedisTimeout<[number, number] | null>(async (c) => {
      const raw = (await c.eval(INCREMENT_LUA, {
        keys: [redisKey],
        arguments: [String(this.windowMs)],
      })) as [number | string, number | string];
      return [Number(raw[0]), Number(raw[1])];
    }, null);

    if (!res) {
      return this.fallbackStore.increment(key);
    }

    const [totalHits, pttl] = res;
    const resetMs = pttl > 0 ? Date.now() + pttl : Date.now() + this.windowMs;
    return {
      totalHits,
      resetTime: new Date(resetMs),
    };
  }

  async decrement(key: string): Promise<void> {
    const client = getRedisClient();
    if (!client || !isRedisReady()) {
      return this.fallbackStore.decrement(key);
    }
    await withRedisTimeout(async (c) => {
      await c.decr(this.formatKey(key));
    }, undefined);
  }

  async resetKey(key: string): Promise<void> {
    const client = getRedisClient();
    if (!client || !isRedisReady()) {
      return this.fallbackStore.resetKey(key);
    }
    await withRedisTimeout(async (c) => {
      await c.del(this.formatKey(key));
    }, undefined);
  }

  async resetAll(): Promise<void> {
    return this.fallbackStore.resetAll?.();
  }
}
