/**
 * Pure (DB-free) helpers for the Resource & Bandwidth system.
 * Everything here is deterministic and unit-tested (tests/resource.test.ts).
 * Canonical unit is BYTES (integers). 1 GB = 1024 MB, 1 MB = 1024 KB.
 */

export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;

export type ResourceCategory = 'storage' | 'image_bandwidth' | 'general_bandwidth';
export const RESOURCE_CATEGORIES: ResourceCategory[] = ['storage', 'image_bandwidth', 'general_bandwidth'];
export type ByteUnit = 'KB' | 'MB' | 'GB';

export const unitToBytes = (quantity: number, unit: ByteUnit): number => {
  const mult = unit === 'GB' ? GB : unit === 'MB' ? MB : KB;
  return Math.max(0, Math.round(Number(quantity) * mult));
};

/** Human friendly formatting (binary units) used in notifications / logs. */
export const formatBytes = (bytes: number): string => {
  const b = Math.max(0, Number(bytes) || 0);
  if (b >= GB) return `${(b / GB).toFixed(2)} GB`;
  if (b >= MB) return `${(b / MB).toFixed(2)} MB`;
  if (b >= KB) return `${(b / KB).toFixed(2)} KB`;
  return `${b} B`;
};

// ───────────────────────── periods ─────────────────────────
export const periodKey = (d: Date = new Date()): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
export const dayKey = (d: Date = new Date()): string => String(d.getUTCDate()).padStart(2, '0');
export const periodStart = (d: Date = new Date()): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
export const periodEnd = (d: Date = new Date()): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
export const previousPeriodKey = (d: Date = new Date()): string =>
  periodKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
export const isValidPeriod = (p: unknown): p is string =>
  typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

// ───────────────────────── percentages / thresholds ─────────────────────────
/** 0 limit means "unlimited" → 0 %. Not capped so over-limit usage is visible. */
export const percentUsed = (used: number, limit: number): number =>
  limit > 0 ? Math.round((Math.max(0, used) / limit) * 10000) / 100 : 0;

export interface WarningThreshold {
  percent: number;
  level: 'info' | 'warning' | 'critical' | 'limit_reached';
  enabled: boolean;
  label?: string | undefined;
}

/**
 * Returns the thresholds the usage has crossed, and the single highest one that
 * has NOT been notified yet (so a jump 60 % → 96 % sends one notification, not three).
 */
export const evaluateThresholds = (
  percent: number,
  thresholds: WarningThreshold[],
  alreadyNotified: number[],
): { crossed: number[]; next: WarningThreshold | null } => {
  const active = thresholds.filter((t) => t.enabled).sort((a, b) => a.percent - b.percent);
  const crossed = active.filter((t) => percent >= t.percent);
  const crossedPercents = crossed.map((t) => t.percent);
  const pending = crossed.filter((t) => !alreadyNotified.includes(t.percent));
  const next = pending.length ? (pending[pending.length - 1] as WarningThreshold) : null;
  return { crossed: crossedPercents, next };
};

export const statusForPercent = (
  percent: number,
  limit: number,
  thresholds: WarningThreshold[],
): 'unlimited' | 'ok' | 'info' | 'warning' | 'critical' | 'limit_reached' => {
  if (!(limit > 0)) return 'unlimited';
  const active = thresholds.filter((t) => t.enabled).sort((a, b) => b.percent - a.percent);
  const hit = active.find((t) => percent >= t.percent);
  return hit ? hit.level : 'ok';
};

// ───────────────────────── response classification ─────────────────────────
const IMAGE_EXT = /\.(webp|png|jpe?g|gif|svg|avif|ico|bmp)(\?|$)/i;

/** A response is counted in exactly ONE category. */
export const classifyResponse = (input: {
  contentType?: string | null | undefined;
  path?: string | null | undefined;
  host?: string | null | undefined;
  mediaHost?: string | null | undefined;
}): 'image' | 'general' => {
  const ct = (input.contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct) return 'general';
  // No content type reported: fall back to media host / extension
  if (input.mediaHost && input.host && input.host.toLowerCase() === input.mediaHost.toLowerCase()) return 'image';
  if (input.path && IMAGE_EXT.test(input.path)) return 'image';
  return 'general';
};

const CACHE_HIT = new Set(['hit', 'stale', 'revalidated', 'updating']);
export const isCacheHit = (status?: string | null): boolean => CACHE_HIT.has((status || '').toLowerCase());

const MERCHANT_PATH_RE = /^\/merchants\/([0-9a-f]{24})\//i;
export const tenantIdFromPath = (path?: string | null): string | null => {
  const m = MERCHANT_PATH_RE.exec(path || '');
  return m && m[1] ? m[1].toLowerCase() : null;
};

/** Extracts the lookup keys for a hostname. Never used for client-supplied merchant ids. */
export const hostLookupKeys = (
  host: string,
  baseDomain: string,
): { slug: string | null; customDomains: string[] } => {
  const h = host.toLowerCase().split(':')[0] || '';
  const bare = h.replace(/^www\./, '');
  if (baseDomain && baseDomain !== 'localhost' && h.endsWith(`.${baseDomain}`) && h !== baseDomain) {
    return { slug: h.split('.')[0] || null, customDomains: [] };
  }
  if (baseDomain === 'localhost' && h.endsWith('.localhost')) {
    return { slug: h.split('.')[0] || null, customDomains: [] };
  }
  return { slug: null, customDomains: [bare, `www.${bare}`] };
};

// ───────────────────────── ingestion windows ─────────────────────────
export interface TimeWindow {
  start: Date;
  end: Date;
}

/**
 * Builds contiguous, epoch-aligned windows between the last processed end and
 * (now - lag). Window boundaries depend only on the interval, so re-running the
 * job always produces identical window keys (idempotency).
 */
export const buildWindows = (opts: {
  lastEnd: Date | null;
  now: Date;
  intervalMin: number;
  lagMin: number;
  maxWindows: number;
}): TimeWindow[] => {
  const intervalMs = Math.max(1, opts.intervalMin) * 60_000;
  const horizon = opts.now.getTime() - Math.max(0, opts.lagMin) * 60_000;
  let cursor = opts.lastEnd
    ? opts.lastEnd.getTime()
    : Math.floor(horizon / intervalMs) * intervalMs - intervalMs;
  const out: TimeWindow[] = [];
  while (cursor + intervalMs <= horizon && out.length < opts.maxWindows) {
    out.push({ start: new Date(cursor), end: new Date(cursor + intervalMs) });
    cursor += intervalMs;
  }
  return out;
};

export const windowKey = (source: string, start: Date): string => `${source}:${start.toISOString()}`;

// ───────────────────────── add-on stacking ─────────────────────────
export interface ActivePurchaseLike {
  quantityBytes: number;
  quantity: number;
  expiresAt?: Date | null;
  status: string;
}

export const sumAddonBytes = (
  purchases: ActivePurchaseLike[],
  stacking: 'stack' | 'highest_only',
  now: Date = new Date(),
): number => {
  const live = purchases.filter(
    (p) => p.status === 'active' && (!p.expiresAt || p.expiresAt.getTime() > now.getTime()),
  );
  const amounts = live.map((p) => Math.max(0, p.quantityBytes) * Math.max(1, p.quantity));
  if (!amounts.length) return 0;
  return stacking === 'highest_only' ? Math.max(...amounts) : amounts.reduce((a, b) => a + b, 0);
};

export const computeAddonExpiry = (
  durationType: 'billing_period' | 'days' | 'subscription_bound' | 'permanent',
  durationDays: number,
  activatedAt: Date,
  subscriptionEnd?: Date | null,
): Date | null => {
  switch (durationType) {
    case 'permanent':
      return null;
    case 'days':
      return new Date(activatedAt.getTime() + Math.max(1, durationDays) * 86_400_000);
    case 'subscription_bound':
      return subscriptionEnd && subscriptionEnd.getTime() > activatedAt.getTime()
        ? subscriptionEnd
        : periodEnd(activatedAt);
    case 'billing_period':
    default:
      return periodEnd(activatedAt);
  }
};

// ───────────────────────── misc ─────────────────────────
export const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** Deep merge; arrays and scalars in `patch` replace those in `base`. */
export const deepMerge = <T extends Record<string, any>>(base: T, patch: Record<string, any>): T => {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
};

export const safeInt = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
