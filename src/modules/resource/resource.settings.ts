import { z } from 'zod';
import { GlobalSetting } from '../system/globalSetting.model';
import { deepMerge, GB } from './resource.logic';

/**
 * Resource & Bandwidth settings. Stored in GlobalSetting.resource (Mixed) and validated
 * here. EVERY limit/threshold/policy comes from the database, never from code.
 * 0 for a byte limit means "unlimited".
 */
const bytes = z.number().int().min(0).max(1024 * 1024 * GB); // up to 1 PB
const threshold = z.object({
  percent: z.number().min(1).max(1000),
  level: z.enum(['info', 'warning', 'critical', 'limit_reached']),
  enabled: z.boolean(),
  label: z.string().max(80).optional(),
});

const overLimitPolicy = z.enum([
  'warn_only',
  'block_uploads',
  'block_uploads_keep_existing',
  'show_prompt',
  'apply_restrictions',
]);

export const resourceSettingsSchema = z.object({
  tracking: z
    .object({
      storage: z.boolean().default(true),
      imageBandwidth: z.boolean().default(true),
      generalTraffic: z.boolean().default(true),
      combinedBandwidth: z.boolean().default(true),
    })
    .prefault({}),
  units: z
    .object({
      displayUnit: z.enum(['auto', 'MB', 'GB']).default('auto'),
      billingPeriod: z.enum(['monthly']).default('monthly'),
      storageCalculation: z.enum(['asset_total_bytes']).default('asset_total_bytes'),
      bandwidthCalculation: z.enum(['edge_response_bytes']).default('edge_response_bytes'),
    })
    .prefault({}),
  /** 'monitor' = track + notify only; 'enforce' = apply over-limit policies. */
  enforcementMode: z.enum(['monitor', 'enforce']).default('enforce'),
  aggregationIntervalMin: z.number().int().min(5).max(120).default(15),
  /** How often dashboards should refresh (minutes). */
  reportingIntervalMin: z.number().int().min(1).max(1440).default(15),
  defaults: z
    .object({
      storageBytes: bytes.default(2 * GB),
      imageBandwidthBytes: bytes.default(0),
      generalBandwidthBytes: bytes.default(0),
      combinedBandwidthBytes: bytes.default(0),
    })
    .prefault({}),
  warning: z
    .object({
      enabled: z.boolean().default(true),
      thresholds: z
        .array(threshold)
        .min(1)
        .max(10)
        .default([
          { percent: 70, level: 'info', enabled: true, label: 'Informational' },
          { percent: 85, level: 'warning', enabled: true, label: 'Warning' },
          { percent: 95, level: 'critical', enabled: true, label: 'Critical warning' },
          { percent: 100, level: 'limit_reached', enabled: true, label: 'Resource limit reached' },
        ]),
      channels: z.object({ inApp: z.boolean().default(true) }).prefault({}),
    })
    .prefault({}),
  overLimit: z
    .object({
      storagePolicy: overLimitPolicy.default('block_uploads'),
      bandwidthPolicy: overLimitPolicy.default('warn_only'),
    })
    .prefault({}),
  billing: z
    .object({
      stacking: z.enum(['stack', 'highest_only']).default('stack'),
    })
    .prefault({}),
  notifications: z
    .object({
      expiryWarnDays: z.number().int().min(0).max(60).default(3),
      onReset: z.boolean().default(true),
      onAddonActivated: z.boolean().default(true),
    })
    .prefault({}),
  analytics: z
    .object({
      retentionMonths: z.number().int().min(1).max(120).default(24),
      cloudflareSyncEnabled: z.boolean().default(false),
      ingestLagMinutes: z.number().int().min(0).max(240).default(20),
    })
    .prefault({}),
});

export type ResourceSettings = z.infer<typeof resourceSettingsSchema>;

export const defaultResourceSettings = (): ResourceSettings => resourceSettingsSchema.parse({});

/** Normalise any stored value (fills defaults, drops garbage). Never throws. */
export const normalizeResourceSettings = (raw: unknown): ResourceSettings => {
  const parsed = resourceSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultResourceSettings();
};

let cache: { value: ResourceSettings; at: number } | null = null;
const CACHE_TTL_MS = 15_000;

export const invalidateResourceSettingsCache = (): void => {
  cache = null;
};

export const getResourceSettings = async (): Promise<ResourceSettings> => {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const doc: any = await GlobalSetting.findOne().select('resource').lean();
  const value = normalizeResourceSettings(doc?.resource);
  cache = { value, at: now };
  return value;
};

/** Validates a partial patch merged over current settings; returns the new full object. */
export const mergeAndValidateSettings = (
  current: ResourceSettings,
  patch: Record<string, unknown>,
): { ok: true; value: ResourceSettings } | { ok: false; errors: string[] } => {
  const merged = deepMerge(current as Record<string, any>, patch || {});
  const parsed = resourceSettingsSchema.safeParse(merged);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const percents = parsed.data.warning.thresholds.map((t) => t.percent);
  if (new Set(percents).size !== percents.length) {
    return { ok: false, errors: ['warning.thresholds: duplicate percent values are not allowed'] };
  }
  return { ok: true, value: parsed.data };
};

export const isBlockingPolicy = (p: string): boolean =>
  p === 'block_uploads' || p === 'block_uploads_keep_existing' || p === 'apply_restrictions';
