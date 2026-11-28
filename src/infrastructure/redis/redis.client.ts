import { createClient, RedisClientType } from 'redis';
import { redisConfig } from '../../config/redis.config';

export type RedisConnectionStatus = 'disabled' | 'connecting' | 'ready' | 'reconnecting' | 'disconnected' | 'error';

interface RedisRuntimeState {
  status: RedisConnectionStatus;
  lastError: string | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  reconnectAttempts: number;
}

const state: RedisRuntimeState = {
  status: redisConfig.enabled ? 'disconnected' : 'disabled',
  lastError: null,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  reconnectAttempts: 0,
};

let client: RedisClientType | null = null;
let initPromise: Promise<RedisClientType | null> | null = null;

/**
 * Initialize the centralized Redis client.
 * Fails open: if Redis is unreachable or disabled, logs a warning and returns null
 * so the application continues serving requests via MongoDB.
 */
export const initRedis = async (): Promise<RedisClientType | null> => {
  if (!redisConfig.enabled) {
    state.status = 'disabled';
    return null;
  }

  if (client && client.isReady) {
    return client;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      state.status = 'connecting';
      const created: RedisClientType = createClient({
        socket: {
          host: redisConfig.host,
          port: redisConfig.port,
          connectTimeout: redisConfig.connectTimeoutMs,
          reconnectStrategy: (retries: number) => {
            state.reconnectAttempts = retries;
            if (retries > 20) {
              // Back off to once every 30 seconds instead of spamming or crashing
              return 30_000;
            }
            return Math.min(retries * 250, 5000);
          },
        },
        ...(redisConfig.password ? { password: redisConfig.password } : {}),
        database: redisConfig.db,
      });

      created.on('ready', () => {
        state.status = 'ready';
        state.lastConnectedAt = new Date();
        state.lastError = null;
        state.reconnectAttempts = 0;
        console.log(`[Redis] Connected and ready at ${redisConfig.host}:${redisConfig.port} (db=${redisConfig.db})`);
      });

      created.on('reconnecting', () => {
        state.status = 'reconnecting';
      });

      created.on('end', () => {
        state.status = 'disconnected';
        state.lastDisconnectedAt = new Date();
      });

      created.on('error', (err: Error) => {
        state.status = 'error';
        state.lastError = err?.message || 'Unknown Redis error';
        if (state.reconnectAttempts <= 3) {
          console.warn(`[Redis] Connection error (fail-open active): ${state.lastError}`);
        }
      });

      client = created;
      await created.connect();
      return created;
    } catch (err: any) {
      state.status = 'error';
      state.lastError = err?.message || 'Failed to connect to Redis';
      console.warn(`[Redis] Initial connection failed (continuing in MongoDB fail-open mode): ${state.lastError}`);
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

/**
 * Returns the active Redis client only if it is ready to accept commands.
 */
export const getRedisClient = (): RedisClientType | null => {
  if (!redisConfig.enabled || !client || !client.isReady) {
    return null;
  }
  return client;
};

export const isRedisReady = (): boolean => {
  return Boolean(redisConfig.enabled && client && client.isReady);
};

export const getRedisState = (): Readonly<RedisRuntimeState> => ({ ...state });

/**
 * Executes a Redis operation with a strict command timeout so slow/hung Redis
 * never stalls Express request handlers.
 */
export const withRedisTimeout = async <T>(
  operation: (c: RedisClientType) => Promise<T>,
  fallback: T
): Promise<T> => {
  const c = getRedisClient();
  if (!c) return fallback;

  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race<T>([
      operation(c),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis command timeout')), redisConfig.commandTimeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    return result;
  } catch (err: any) {
    state.lastError = err?.message || 'Redis operation failed';
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Gracefully closes the Redis connection on application shutdown.
 */
export const closeRedis = async (): Promise<void> => {
  if (!client) return;
  try {
    if (client.isOpen) {
      await client.quit();
    }
  } catch {
    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors on shutdown
    }
  } finally {
    client = null;
    state.status = redisConfig.enabled ? 'disconnected' : 'disabled';
  }
};
