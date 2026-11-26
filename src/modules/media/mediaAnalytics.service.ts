import axios from 'axios';
import { Types } from 'mongoose';
import config from '../../config';
import { MediaUsage } from './mediaUsage.model';
import { getCurrentMonthKey } from './media.service';

export interface CloudflarePathMetric {
  path: string;
  requests: number;
  bytes: number;
}

const MERCHANT_PATH_RE = /^\/merchants\/([0-9a-f]{24})\//i;

/** Aggregates path-level Cloudflare GraphQL metrics into per-merchant totals. */
export const aggregateMetricsByMerchant = (
  rows: CloudflarePathMetric[],
): Map<string, { requests: number; bytes: number }> => {
  const totals = new Map<string, { requests: number; bytes: number }>();
  for (const row of rows) {
    if (!row.path) continue;
    const match = MERCHANT_PATH_RE.exec(row.path);
    if (!match || !match[1]) continue;
    const tenantId = match[1].toLowerCase();
    const cur = totals.get(tenantId) || { requests: 0, bytes: 0 };
    cur.requests += Math.max(0, Number(row.requests) || 0);
    cur.bytes += Math.max(0, Number(row.bytes) || 0);
    totals.set(tenantId, cur);
  }
  return totals;
};

/**
 * Syncs per-merchant read requests and delivery bytes for the current UTC month
 * from Cloudflare's GraphQL Analytics API (`httpRequestsAdaptiveGroups`).
 * Requires `MEDIA_ANALYTICS_SYNC=true`, `CLOUDFLARE_ZONE_ID`, and `CLOUDFLARE_API_TOKEN`
 * (with Zone -> Analytics: Read permission).
 */
export const syncCloudflareMediaAnalytics = async (): Promise<{
  synced: boolean;
  merchantsUpdated: number;
  reason?: string;
}> => {
  if (!config.media.analyticsSyncEnabled) {
    return { synced: false, merchantsUpdated: 0, reason: 'MEDIA_ANALYTICS_SYNC is not enabled' };
  }

  const { zoneId, apiToken } = config.cloudflare;
  if (!zoneId || !apiToken) {
    return { synced: false, merchantsUpdated: 0, reason: 'Missing CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN' };
  }

  let mediaHost = 'media.masheco.com';
  try {
    mediaHost = new URL(config.r2.publicUrl).hostname;
  } catch {
    /* keep default */
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const month = getCurrentMonthKey(now);

  const query = `
    query MediaReads($zoneTag: String!, $since: Time!, $until: Time!, $host: String!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 5000
            filter: {
              datetime_geq: $since
              datetime_leq: $until
              clientRequestHTTPHost: $host
            }
          ) {
            count
            sum {
              edgeResponseBytes
            }
            dimensions {
              clientRequestPath
            }
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      'https://api.cloudflare.com/client/v4/graphql',
      {
        query,
        variables: {
          zoneTag: zoneId,
          since: monthStart.toISOString(),
          until: now.toISOString(),
          host: mediaHost,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    );

    const errors = response.data?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const msg = errors.map((e: any) => e.message).join('; ');
      console.warn('[media:analytics] Cloudflare GraphQL returned errors:', msg);
      return { synced: false, merchantsUpdated: 0, reason: msg };
    }

    const groups = response.data?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];
    const rows: CloudflarePathMetric[] = groups.map((g: any) => ({
      path: String(g?.dimensions?.clientRequestPath || ''),
      requests: Number(g?.count || 0),
      bytes: Number(g?.sum?.edgeResponseBytes || 0),
    }));

    const byMerchant = aggregateMetricsByMerchant(rows);
    const updatedAt = new Date();
    let merchantsUpdated = 0;

    for (const [tenantId, metrics] of byMerchant.entries()) {
      await MediaUsage.updateOne(
        { tenantId: new Types.ObjectId(tenantId), month, provider: 'r2' },
        {
          $set: {
            deliveryRequests: metrics.requests,
            deliveryBytes: metrics.bytes,
            deliverySource: 'cloudflare_graphql',
            deliveryUpdatedAt: updatedAt,
          },
          $setOnInsert: {
            tenantId: new Types.ObjectId(tenantId),
            month,
            provider: 'r2',
          },
        },
        { upsert: true },
      );
      merchantsUpdated++;
    }

    return { synced: true, merchantsUpdated };
  } catch (error: any) {
    const msg = error?.response?.data?.errors?.[0]?.message || error?.message || 'Unknown error';
    console.warn('[media:analytics] Failed to sync Cloudflare media analytics:', msg);
    return { synced: false, merchantsUpdated: 0, reason: msg };
  }
};
