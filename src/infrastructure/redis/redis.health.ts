import { redisConfig } from '../../config/redis.config';
import { getRedisClient, getRedisState, isRedisReady } from './redis.client';

export interface RedisInfoSnapshot {
  connected: boolean;
  enabled: boolean;
  status: string;
  host: string;
  port: number;
  version: string | null;
  uptimeSeconds: number;
  connectedClients: number;
  totalKeys: number;
  totalCommandsProcessed: number;
  opsPerSec: number;
  memory: {
    usedMemoryBytes: number;
    usedMemoryHuman: string;
    usedMemoryPeakBytes: number;
    usedMemoryPeakHuman: string;
    usedMemoryRssBytes: number;
    usedMemoryRssHuman: string;
    maxMemoryBytes: number;
    maxMemoryHuman: string;
    configuredMaxMemoryMb: number;
    memoryUsagePercent: number;
    fragmentationRatio: number;
    evictionPolicy: string;
  };
  stats: {
    keyspaceHits: number;
    keyspaceMisses: number;
    hitRatePercent: number;
    evictedKeys: number;
    expiredKeys: number;
  };
  lastError: string | null;
  lastConnectedAt: Date | null;
  checkedAt: string;
}

const parseRedisInfo = (raw: string): Record<string, string> => {
  const map: Record<string, string> = {};
  if (!raw) return map;
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx > 0) {
      map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return map;
};

const toNum = (val: string | undefined, fallback = 0): number => {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, idx)).toFixed(2)} ${units[idx]}`;
};

export const getRedisInfoSnapshot = async (): Promise<RedisInfoSnapshot> => {
  const runtimeState = getRedisState();
  const client = getRedisClient();

  const emptySnapshot: RedisInfoSnapshot = {
    connected: false,
    enabled: redisConfig.enabled,
    status: runtimeState.status,
    host: redisConfig.host,
    port: redisConfig.port,
    version: null,
    uptimeSeconds: 0,
    connectedClients: 0,
    totalKeys: 0,
    totalCommandsProcessed: 0,
    opsPerSec: 0,
    memory: {
      usedMemoryBytes: 0,
      usedMemoryHuman: '0 B',
      usedMemoryPeakBytes: 0,
      usedMemoryPeakHuman: '0 B',
      usedMemoryRssBytes: 0,
      usedMemoryRssHuman: '0 B',
      maxMemoryBytes: redisConfig.maxMemoryMb * 1024 * 1024,
      maxMemoryHuman: `${redisConfig.maxMemoryMb} MB`,
      configuredMaxMemoryMb: redisConfig.maxMemoryMb,
      memoryUsagePercent: 0,
      fragmentationRatio: 0,
      evictionPolicy: 'allkeys-lru',
    },
    stats: {
      keyspaceHits: 0,
      keyspaceMisses: 0,
      hitRatePercent: 0,
      evictedKeys: 0,
      expiredKeys: 0,
    },
    lastError: runtimeState.lastError,
    lastConnectedAt: runtimeState.lastConnectedAt,
    checkedAt: new Date().toISOString(),
  };

  if (!client || !isRedisReady()) {
    return emptySnapshot;
  }

  try {
    const [infoRaw, dbSize] = await Promise.all([
      client.info(),
      client.dbSize(),
    ]);
    const info = parseRedisInfo(infoRaw);

    const usedMemoryBytes = toNum(info.used_memory);
    const configuredMaxBytes = toNum(info.maxmemory) || redisConfig.maxMemoryMb * 1024 * 1024;
    const memoryUsagePercent = configuredMaxBytes > 0
      ? Number(((usedMemoryBytes / configuredMaxBytes) * 100).toFixed(2))
      : 0;

    const hits = toNum(info.keyspace_hits);
    const misses = toNum(info.keyspace_misses);
    const totalLookups = hits + misses;
    const hitRatePercent = totalLookups > 0 ? Number(((hits / totalLookups) * 100).toFixed(2)) : 0;

    return {
      connected: true,
      enabled: redisConfig.enabled,
      status: 'ready',
      host: redisConfig.host,
      port: redisConfig.port,
      version: info.redis_version || null,
      uptimeSeconds: toNum(info.uptime_in_seconds),
      connectedClients: toNum(info.connected_clients),
      totalKeys: dbSize,
      totalCommandsProcessed: toNum(info.total_commands_processed),
      opsPerSec: toNum(info.instantaneous_ops_per_sec),
      memory: {
        usedMemoryBytes,
        usedMemoryHuman: info.used_memory_human || formatBytes(usedMemoryBytes),
        usedMemoryPeakBytes: toNum(info.used_memory_peak),
        usedMemoryPeakHuman: info.used_memory_peak_human || formatBytes(toNum(info.used_memory_peak)),
        usedMemoryRssBytes: toNum(info.used_memory_rss),
        usedMemoryRssHuman: info.used_memory_rss_human || formatBytes(toNum(info.used_memory_rss)),
        maxMemoryBytes: configuredMaxBytes,
        maxMemoryHuman: info.maxmemory_human || formatBytes(configuredMaxBytes),
        configuredMaxMemoryMb: redisConfig.maxMemoryMb,
        memoryUsagePercent,
        fragmentationRatio: toNum(info.mem_fragmentation_ratio),
        evictionPolicy: info.maxmemory_policy || 'allkeys-lru',
      },
      stats: {
        keyspaceHits: hits,
        keyspaceMisses: misses,
        hitRatePercent,
        evictedKeys: toNum(info.evicted_keys),
        expiredKeys: toNum(info.expired_keys),
      },
      lastError: runtimeState.lastError,
      lastConnectedAt: runtimeState.lastConnectedAt,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      ...emptySnapshot,
      status: 'error',
      lastError: err?.message || 'Failed to query Redis INFO',
    };
  }
};

export const pingRedis = async (): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> => {
  const client = getRedisClient();
  if (!client) {
    return { ok: false, latencyMs: null, error: getRedisState().lastError || 'Redis not connected' };
  }
  const start = process.hrtime.bigint();
  try {
    await client.ping();
    const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { ok: true, latencyMs: Number(latencyMs.toFixed(2)) };
  } catch (err: any) {
    return { ok: false, latencyMs: null, error: err?.message || 'Ping failed' };
  }
};
