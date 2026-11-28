import crypto from 'crypto';
import { getRedisClient, isRedisReady } from '../../infrastructure/redis/redis.client';

const inFlightPromises = new Map<string, Promise<unknown>>();

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lightweight single-flight + optional Redis distributed lock to prevent cache stampedes.
 * 1) Same-process concurrent callers share the exact same Promise (zero duplicate DB queries).
 * 2) Cross-process callers coordinate via a short-TTL Redis NX lock with safe token release.
 */
export const withStampedeProtection = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { lockTtlMs?: number; waitMs?: number } = {}
): Promise<T> => {
  const existingFlight = inFlightPromises.get(key) as Promise<T> | undefined;
  if (existingFlight) {
    return existingFlight;
  }

  const lockTtlMs = options.lockTtlMs ?? 3000;
  const waitMs = options.waitMs ?? 120;

  const flight = (async (): Promise<T> => {
    const client = getRedisClient();
    if (!client || !isRedisReady()) {
      return fetcher();
    }

    const lockKey = `lock:${key}`;
    const token = crypto.randomBytes(8).toString('hex');
    let acquired = false;

    try {
      const setRes = await client.set(lockKey, token, { NX: true, PX: lockTtlMs });
      acquired = setRes === 'OK';

      if (!acquired) {
        // Another worker is populating the cache; wait briefly then check cache once
        await sleep(waitMs);
        try {
          const cached = await client.get(key);
          if (cached !== null) {
            return JSON.parse(cached) as T;
          }
        } catch {
          // Fall through to DB fetch on parse/read error
        }
      }

      return await fetcher();
    } catch {
      // Fail open to DB if Redis lock errors
      return fetcher();
    } finally {
      if (acquired) {
        try {
          await client.eval(RELEASE_LOCK_LUA, {
            keys: [lockKey],
            arguments: [token],
          });
        } catch {
          // Lock will auto-expire via PX
        }
      }
    }
  })();

  inFlightPromises.set(key, flight);
  try {
    return await flight;
  } finally {
    inFlightPromises.delete(key);
  }
};
