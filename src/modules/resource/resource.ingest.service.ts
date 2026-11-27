import axios from 'axios';
import { Types } from 'mongoose';
import config from '../../config';
import { Tenant } from '../tenant/tenant.model';
import { MerchantResourceUsage, ResourceIngestCheckpoint } from './resource.model';
import { getEffectiveLimits } from './resource.limits';
import { getResourceSettings } from './resource.settings';
import { evaluateBandwidthNotifications, notifyPeriodReset } from './resource.usage.service';
import {
  buildWindows,
  classifyResponse,
  dayKey,
  hostLookupKeys,
  isCacheHit,
  periodKey,
  safeInt,
  tenantIdFromPath,
  windowKey,
  TimeWindow,
} from './resource.logic';

/** One aggregated measurement row (NOT one row per HTTP request). */
export interface UsageRow {
  /** Only set by trusted internal producers (mock endpoint / tests). Never from a client. */
  tenantId?: string | undefined;
  host?: string | undefined;
  path?: string | undefined;
  contentType?: string | undefined;
  cacheStatus?: string | undefined;
  bytes: number;
  requests: number;
}

interface Totals {
  imageBytes: number;
  imageRequests: number;
  cacheHit: number;
  cacheMiss: number;
  generalBytes: number;
  generalRequests: number;
}
const emptyTotals = (): Totals => ({
  imageBytes: 0, imageRequests: 0, cacheHit: 0, cacheMiss: 0, generalBytes: 0, generalRequests: 0,
});

/* ───────────── host → tenant resolution (bounded in-memory cache) ───────────── */
const hostCache = new Map<string, { id: string | null; at: number }>();
const HOST_TTL = 5 * 60_000;
const HOST_MAX = 2000;

export const resolveTenantsForHosts = async (hosts: string[]): Promise<Map<string, string | null>> => {
  const out = new Map<string, string | null>();
  const now = Date.now();
  const unknown: string[] = [];
  for (const h of hosts) {
    const c = hostCache.get(h);
    if (c && now - c.at < HOST_TTL) out.set(h, c.id);
    else unknown.push(h);
  }
  if (unknown.length) {
    const baseDomain = config.app.baseDomain || 'localhost';
    const slugs: string[] = [];
    const custom: string[] = [];
    const keysByHost = new Map<string, ReturnType<typeof hostLookupKeys>>();
    for (const h of unknown) {
      const k = hostLookupKeys(h, baseDomain);
      keysByHost.set(h, k);
      if (k.slug) slugs.push(k.slug);
      custom.push(...k.customDomains);
    }
    const tenants: any[] = await Tenant.find({
      $or: [
        ...(slugs.length ? [{ slug: { $in: slugs } }] : []),
        ...(custom.length ? [{ customDomain: { $in: custom } }] : []),
      ],
    })
      .select('_id slug customDomain')
      .lean();
    for (const h of unknown) {
      const k = keysByHost.get(h)!;
      const t = tenants.find((x) => (k.slug && x.slug === k.slug) || (x.customDomain && k.customDomains.includes(x.customDomain)));
      const id = t ? String(t._id) : null;
      out.set(h, id);
      if (hostCache.size >= HOST_MAX) hostCache.delete(hostCache.keys().next().value as string);
      hostCache.set(h, { id, at: now });
    }
  }
  return out;
};

export const clearHostCache = (): void => hostCache.clear();

/* ───────────── core idempotent ingestion ───────────── */
export interface IngestResult {
  skipped?: boolean;
  reason?: string;
  tenantsUpdated: number;
  tenantsAlreadyApplied: number;
  unattributedBytes: number;
  rows: number;
}

export const ingestWindow = async (args: {
  source: string;
  windowStart: Date;
  windowEnd: Date;
  rows: UsageRow[];
  mediaHost?: string | undefined;
}): Promise<IngestResult> => {
  const settings = await getResourceSettings();
  const key = windowKey(args.source, args.windowStart);
  const now = new Date();

  // 1. claim the window (unique key → a done / actively leased window cannot be claimed twice)
  try {
    const claimed = await ResourceIngestCheckpoint.findOneAndUpdate(
      { key, status: { $ne: 'done' }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
      {
        $set: { status: 'processing', leaseUntil: new Date(now.getTime() + 5 * 60_000) },
        $inc: { attempts: 1 },
        $setOnInsert: { key, source: args.source, windowStart: args.windowStart, windowEnd: args.windowEnd },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!claimed) return { skipped: true, reason: 'not_claimable', tenantsUpdated: 0, tenantsAlreadyApplied: 0, unattributedBytes: 0, rows: args.rows.length };
  } catch (e: any) {
    if (e?.code === 11000) {
      return { skipped: true, reason: 'already_done_or_in_progress', tenantsUpdated: 0, tenantsAlreadyApplied: 0, unattributedBytes: 0, rows: args.rows.length };
    }
    throw e;
  }

  try {
    // 2. attribute rows to merchants (server-side only)
    const hosts = Array.from(new Set(args.rows.filter((r) => !r.tenantId && !tenantIdFromPath(r.path) && r.host).map((r) => (r.host as string).toLowerCase())));
    const hostMap = await resolveTenantsForHosts(hosts);
    const byTenant = new Map<string, Totals>();
    let unattributed = 0;

    for (const r of args.rows) {
      const bytes = safeInt(r.bytes);
      const requests = safeInt(r.requests);
      const tid =
        (r.tenantId && Types.ObjectId.isValid(r.tenantId) ? r.tenantId.toLowerCase() : null) ||
        tenantIdFromPath(r.path) ||
        (r.host ? hostMap.get(r.host.toLowerCase()) ?? null : null);
      if (!tid) {
        unattributed += bytes;
        continue;
      }
      const cls = classifyResponse({ contentType: r.contentType, path: r.path, host: r.host, mediaHost: args.mediaHost });
      const t = byTenant.get(tid) || emptyTotals();
      if (cls === 'image') {
        t.imageBytes += bytes;
        t.imageRequests += requests;
        if (isCacheHit(r.cacheStatus)) t.cacheHit += requests; else t.cacheMiss += requests;
      } else {
        t.generalBytes += bytes;
        t.generalRequests += requests;
      }
      byTenant.set(tid, t);
    }

    // 3. apply per tenant: one atomic doc update (counters + daily bucket + applied-window marker)
    const period = periodKey(args.windowStart);
    const day = dayKey(args.windowStart);
    let updated = 0;
    let already = 0;

    for (const [tid, t] of byTenant.entries()) {
      const tenantOid = new Types.ObjectId(tid);
      const inc: Record<string, number> = {};
      if (settings.tracking.imageBandwidth) {
        inc['image.bytes'] = t.imageBytes; inc['image.requests'] = t.imageRequests;
        inc['image.cacheHit'] = t.cacheHit; inc['image.cacheMiss'] = t.cacheMiss;
        inc[`daily.${day}.imageBytes`] = t.imageBytes; inc[`daily.${day}.imageRequests`] = t.imageRequests;
      }
      if (settings.tracking.generalTraffic) {
        inc['general.bytes'] = t.generalBytes; inc['general.requests'] = t.generalRequests;
        inc[`daily.${day}.generalBytes`] = t.generalBytes; inc[`daily.${day}.generalRequests`] = t.generalRequests;
      }
      if (!Object.keys(inc).length) continue;

      const limits = await getEffectiveLimits(tenantOid);
      const existed = await MerchantResourceUsage.exists({ tenantId: tenantOid, period });
      try {
        const res = await MerchantResourceUsage.updateOne(
          { tenantId: tenantOid, period, appliedWindows: { $ne: key } },
          {
            $inc: inc,
            $push: { appliedWindows: { $each: [key], $slice: -400 } },
            $set: {
              limits: {
                imageBytes: limits.imageBandwidth.totalBytes,
                generalBytes: limits.generalBandwidth.totalBytes,
                combinedBytes: limits.combined.totalBytes,
              },
              dataThrough: args.windowEnd,
            },
            $setOnInsert: { tenantId: tenantOid, period },
          },
          { upsert: true },
        );
        if (res.modifiedCount || res.upsertedCount) {
          updated++;
          if (!existed) await notifyPeriodReset(tenantOid, args.windowStart).catch(() => {});
          await evaluateBandwidthNotifications(tenantOid, period).catch((e) => console.error('[resource] notify failed', e));
        }
      } catch (e: any) {
        // duplicate key on upsert = window already applied to this tenant's doc
        if (e?.code === 11000) already++;
        else throw e;
      }
    }

    const stats = { tenantsUpdated: updated, tenantsAlreadyApplied: already, unattributedBytes: unattributed, rows: args.rows.length };
    await ResourceIngestCheckpoint.updateOne({ key }, { $set: { status: 'done', leaseUntil: null, stats, error: '' } });
    return stats;
  } catch (err: any) {
    await ResourceIngestCheckpoint.updateOne({ key }, { $set: { status: 'failed', leaseUntil: null, error: String(err?.message || err).slice(0, 500) } });
    throw err;
  }
};

/* ───────────── Cloudflare GraphQL pull (read-only) ───────────── */
const GQL = 'https://api.cloudflare.com/client/v4/graphql';
const GROUP_LIMIT = 10000;

const runGraphql = async (query: string, variables: Record<string, any>) => {
  const res = await axios.post(
    GQL,
    { query, variables },
    { headers: { Authorization: `Bearer ${config.cloudflare.apiToken}`, 'Content-Type': 'application/json' }, timeout: 20000 },
  );
  const errors = res.data?.errors;
  if (Array.isArray(errors) && errors.length) throw new Error(errors.map((e: any) => e.message).join('; '));
  return res.data?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];
};

export const getMediaHost = (): string => {
  try {
    return new URL(config.r2.publicUrl).hostname;
  } catch {
    return 'media.masheco.com';
  }
};

/**
 * Pulls one window of edge response bytes. Query A: all store hosts (host × content-type × cache status).
 * Query B: the media host grouped by path (to read the /merchants/{id}/ prefix).
 * NOTE: dimension names must be confirmed with scripts/resourceProbe.ts against the live account.
 */
export const pullCloudflareWindow = async (w: TimeWindow): Promise<{ rows: UsageRow[]; truncated: boolean }> => {
  const mediaHost = getMediaHost();
  const common = { zoneTag: config.cloudflare.zoneId, since: w.start.toISOString(), until: w.end.toISOString(), host: mediaHost };

  const qHosts = `query($zoneTag:String!,$since:Time!,$until:Time!,$host:String!){viewer{zones(filter:{zoneTag:$zoneTag}){
    httpRequestsAdaptiveGroups(limit:${GROUP_LIMIT},filter:{datetime_geq:$since,datetime_lt:$until,clientRequestHTTPHost_neq:$host}){
      count sum{edgeResponseBytes} dimensions{clientRequestHTTPHost edgeResponseContentType cacheStatus}}}}}`;
  const qMedia = `query($zoneTag:String!,$since:Time!,$until:Time!,$host:String!){viewer{zones(filter:{zoneTag:$zoneTag}){
    httpRequestsAdaptiveGroups(limit:${GROUP_LIMIT},filter:{datetime_geq:$since,datetime_lt:$until,clientRequestHTTPHost:$host}){
      count sum{edgeResponseBytes} dimensions{clientRequestPath cacheStatus edgeResponseContentType}}}}}`;

  const [a, b] = await Promise.all([runGraphql(qHosts, common), runGraphql(qMedia, common)]);
  const rows: UsageRow[] = [
    ...a.map((g: any) => ({
      host: String(g.dimensions?.clientRequestHTTPHost || ''),
      contentType: String(g.dimensions?.edgeResponseContentType || ''),
      cacheStatus: String(g.dimensions?.cacheStatus || ''),
      bytes: Number(g.sum?.edgeResponseBytes || 0),
      requests: Number(g.count || 0),
    })),
    ...b.map((g: any) => ({
      host: mediaHost,
      path: String(g.dimensions?.clientRequestPath || ''),
      contentType: String(g.dimensions?.edgeResponseContentType || '') || 'image/webp',
      cacheStatus: String(g.dimensions?.cacheStatus || ''),
      bytes: Number(g.sum?.edgeResponseBytes || 0),
      requests: Number(g.count || 0),
    })),
  ];
  return { rows, truncated: a.length >= GROUP_LIMIT || b.length >= GROUP_LIMIT };
};

/** Cron entry. Processes contiguous windows after the last completed one; stops at the first failure. */
export const runCloudflareIngestCycle = async (): Promise<{ ran: boolean; windows: number; reason?: string }> => {
  const settings = await getResourceSettings();
  if (!settings.analytics.cloudflareSyncEnabled) return { ran: false, windows: 0, reason: 'disabled in settings' };
  if (!config.cloudflare.zoneId || !config.cloudflare.apiToken) return { ran: false, windows: 0, reason: 'missing CLOUDFLARE_ZONE_ID/API_TOKEN' };

  const last: any = await ResourceIngestCheckpoint.findOne({ source: 'cloudflare', status: 'done' }).sort({ windowEnd: -1 }).lean();
  const windows = buildWindows({
    lastEnd: last ? new Date(last.windowEnd) : null,
    now: new Date(),
    intervalMin: settings.aggregationIntervalMin,
    lagMin: settings.analytics.ingestLagMinutes,
    maxWindows: 12,
  });
  let done = 0;
  for (const w of windows) {
    try {
      const { rows, truncated } = await pullCloudflareWindow(w);
      if (truncated) console.warn('[resource:ingest] Cloudflare result truncated for window', w.start.toISOString());
      await ingestWindow({ source: 'cloudflare', windowStart: w.start, windowEnd: w.end, rows, mediaHost: getMediaHost() });
      done++;
    } catch (err: any) {
      console.error('[resource:ingest] window failed:', w.start.toISOString(), err?.message || err);
      break;
    }
  }
  return { ran: true, windows: done };
};
