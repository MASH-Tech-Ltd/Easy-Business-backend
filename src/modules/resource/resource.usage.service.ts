import { Types } from 'mongoose';
import CustomError from '../../helpers/CustomError';
import { Tenant } from '../tenant/tenant.model';
import { notificationService } from '../notification/notification.service';
import { MediaAsset } from '../media/media.model';
import { MerchantStorageState, MerchantResourceUsage, ResourceAddonPurchase } from './resource.model';
import { getEffectiveLimits, EffectiveLimits } from './resource.limits';
import { isBlockingPolicy } from './resource.settings';
import {
  evaluateThresholds,
  formatBytes,
  percentUsed,
  periodKey,
  previousPeriodKey,
  statusForPercent,
  WarningThreshold,
} from './resource.logic';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/* ───────────────────────── notifications (deduplicated) ───────────────────────── */
const LEVEL_TITLE: Record<string, string> = {
  info: 'Resource usage notice',
  warning: 'Resource usage warning',
  critical: 'Critical: resource almost exhausted',
  limit_reached: 'Resource limit reached',
};

export const notifyTenantOwner = async (
  tenantId: string | Types.ObjectId,
  type: string,
  title: string,
  message: string,
  relatedId?: string | Types.ObjectId,
): Promise<void> => {
  try {
    const tenant: any = await Tenant.findById(tenantId).select('ownerId').lean();
    if (!tenant?.ownerId) return;
    await notificationService.createNotification(tenant.ownerId, type, title, message, relatedId, tenantId);
  } catch (err) {
    console.error('[resource:notify] failed:', err);
  }
};

/**
 * Sends at most ONE notification per newly crossed threshold. The `notified` array
 * is updated with a conditional atomic write, so concurrent callers can never both send.
 */
const maybeNotifyThreshold = async (args: {
  model: any;
  docId: Types.ObjectId;
  path: string; // e.g. 'notified' or 'notified.image'
  already: number[];
  used: number;
  limit: number;
  thresholds: WarningThreshold[];
  label: string;
  tenantId: Types.ObjectId;
  enabled: boolean;
}): Promise<void> => {
  if (!args.enabled || !(args.limit > 0)) return;
  const pct = percentUsed(args.used, args.limit);
  const { crossed, next } = evaluateThresholds(pct, args.thresholds, args.already);
  if (!next) return;
  const res = await args.model.updateOne(
    { _id: args.docId, [args.path]: { $ne: next.percent } },
    { $addToSet: { [args.path]: { $each: crossed } } },
  );
  if (!res.modifiedCount) return; // another worker already notified
  await notifyTenantOwner(
    args.tenantId,
    'RESOURCE_THRESHOLD',
    LEVEL_TITLE[next.level] || 'Resource usage',
    `${args.label}: ${pct}% used (${formatBytes(args.used)} of ${formatBytes(args.limit)}). ` +
      (next.level === 'limit_reached'
        ? 'Your allocation is exhausted. Purchase an add-on to continue without interruption.'
        : 'Consider purchasing an add-on to avoid interruption.'),
  );
};

/* ───────────────────────── storage gauge ───────────────────────── */
export const ensureStorageState = async (tenantId: string | Types.ObjectId) => {
  const tid = oid(tenantId);
  const existing = await MerchantStorageState.findOne({ tenantId: tid });
  if (existing) return existing;
  // Lazy bootstrap from the existing MediaAsset inventory (DB only, no R2 listing)
  const agg = await MediaAsset.aggregate([
    { $match: { tenantId: tid, status: { $in: ['active', 'pending_delete'] } } },
    { $group: { _id: null, bytes: { $sum: '$totalBytes' }, files: { $sum: 1 } } },
  ]);
  try {
    await MerchantStorageState.updateOne(
      { tenantId: tid },
      { $setOnInsert: { tenantId: tid, usedBytes: agg[0]?.bytes || 0, fileCount: agg[0]?.files || 0 } },
      { upsert: true },
    );
  } catch (e: any) {
    if (e?.code !== 11000) throw e;
  }
  return (await MerchantStorageState.findOne({ tenantId: tid }))!;
};

const storageEnforced = (limits: EffectiveLimits): boolean =>
  limits.settings.tracking.storage &&
  limits.trackingEnabled &&
  limits.policy.enforcement === 'enforce' &&
  limits.storage.totalBytes > 0 &&
  isBlockingPolicy(limits.policy.storage);

const afterStorageChange = async (tenantId: Types.ObjectId, limits: EffectiveLimits) => {
  const state: any = await MerchantStorageState.findOne({ tenantId });
  if (!state) return;
  const limit = limits.storage.totalBytes;
  const thresholds = limits.settings.warning.thresholds;
  const pct = percentUsed(state.usedBytes, limit);
  // usage dropped below previously notified thresholds → allow notifying again later
  const stale = (state.notified as number[]).filter((p) => p > pct);
  if (stale.length) await MerchantStorageState.updateOne({ _id: state._id }, { $pull: { notified: { $in: stale } } });
  await maybeNotifyThreshold({
    model: MerchantStorageState,
    docId: state._id,
    path: 'notified',
    already: (state.notified as number[]).filter((p) => p <= pct),
    used: state.usedBytes,
    limit,
    thresholds,
    label: 'Image storage',
    tenantId,
    enabled:
      limits.settings.warning.enabled &&
      limits.settings.warning.channels.inApp &&
      limits.settings.tracking.storage &&
      limits.trackingEnabled,
  });
};

/**
 * Atomically reserves `estimateBytes` before an upload. When the effective policy
 * blocks uploads and the reservation would exceed the limit, nothing is changed and 403 is thrown.
 */
export const reserveStorage = async (tenantId: string | Types.ObjectId, estimateBytes: number): Promise<number> => {
  const tid = oid(tenantId);
  const est = Math.max(0, Math.round(estimateBytes || 0));
  const limits = await getEffectiveLimits(tid);
  await ensureStorageState(tid);
  const limit = limits.storage.totalBytes;

  if (storageEnforced(limits)) {
    const updated = await MerchantStorageState.findOneAndUpdate(
      { tenantId: tid, $expr: { $lte: [{ $add: ['$usedBytes', est] }, limit] } },
      { $inc: { usedBytes: est }, $set: { limitBytes: limit } },
      { returnDocument: 'after' },
    );
    if (!updated) {
      await afterStorageChange(tid, limits).catch(() => {});
      throw new CustomError(
        403,
        'MEDIA_STORAGE_LIMIT_REACHED: You have reached your image storage limit. Please delete unused images or purchase a storage add-on.',
      );
    }
  } else {
    await MerchantStorageState.updateOne({ tenantId: tid }, { $inc: { usedBytes: est }, $set: { limitBytes: limit } });
  }
  return est;
};

/** Called after a successful, persisted upload: swaps the estimate for the real size and counts the file. */
export const finalizeStorage = async (
  tenantId: string | Types.ObjectId,
  reservedBytes: number,
  actualBytes: number,
): Promise<void> => {
  const tid = oid(tenantId);
  const delta = Math.round(actualBytes) - Math.round(reservedBytes);
  await MerchantStorageState.updateOne({ tenantId: tid }, { $inc: { usedBytes: delta, fileCount: 1 } });
  await clampStorage(tid);
  await afterStorageChange(tid, await getEffectiveLimits(tid)).catch(() => {});
};

/** Returns bytes (and optionally file count) to the merchant: failed upload, delete or replace. */
export const releaseStorage = async (
  tenantId: string | Types.ObjectId | null | undefined,
  bytes: number,
  files = 0,
): Promise<void> => {
  if (!tenantId) return;
  const tid = oid(tenantId);
  const b = Math.max(0, Math.round(bytes || 0));
  if (!b && !files) return;
  // First time we see this merchant: the lazy bootstrap is computed from MediaAsset, whose status
  // already reflects this deletion, so we must NOT subtract again (would double-count).
  const existed = await MerchantStorageState.exists({ tenantId: tid });
  if (!existed) {
    await ensureStorageState(tid);
    return;
  }
  await MerchantStorageState.updateOne({ tenantId: tid }, { $inc: { usedBytes: -b, fileCount: -Math.max(0, files) } });
  await clampStorage(tid);
  await afterStorageChange(tid, await getEffectiveLimits(tid)).catch(() => {});
};

const clampStorage = async (tid: Types.ObjectId) => {
  await MerchantStorageState.updateOne({ tenantId: tid, usedBytes: { $lt: 0 } }, { $set: { usedBytes: 0 } });
  await MerchantStorageState.updateOne({ tenantId: tid, fileCount: { $lt: 0 } }, { $set: { fileCount: 0 } });
};

/** Recomputes the gauge from MediaAsset (DB-only) and reports drift. */
export const reconcileStorage = async (tenantId: string | Types.ObjectId) => {
  const tid = oid(tenantId);
  await ensureStorageState(tid);
  const agg = await MediaAsset.aggregate([
    { $match: { tenantId: tid, status: { $in: ['active', 'pending_delete'] } } },
    { $group: { _id: null, bytes: { $sum: '$totalBytes' }, files: { $sum: 1 } } },
  ]);
  const real = agg[0]?.bytes || 0;
  const files = agg[0]?.files || 0;
  const before: any = await MerchantStorageState.findOne({ tenantId: tid }).lean();
  const limits = await getEffectiveLimits(tid);
  await MerchantStorageState.updateOne(
    { tenantId: tid },
    {
      $set: {
        usedBytes: real,
        fileCount: files,
        limitBytes: limits.storage.totalBytes,
        reconciledAt: new Date(),
        lastDriftBytes: real - (before?.usedBytes || 0),
      },
    },
  );
  await afterStorageChange(tid, limits).catch(() => {});
  return { before: before?.usedBytes || 0, after: real, driftBytes: real - (before?.usedBytes || 0), files };
};

/* ───────────────────────── bandwidth threshold check (called by ingestion) ───────────────────────── */
export const evaluateBandwidthNotifications = async (tenantId: Types.ObjectId, period: string) => {
  const doc: any = await MerchantResourceUsage.findOne({ tenantId, period });
  if (!doc) return;
  const limits = await getEffectiveLimits(tenantId);
  const s = limits.settings;
  const on = s.warning.enabled && s.warning.channels.inApp && limits.trackingEnabled;
  const th = s.warning.thresholds;
  await maybeNotifyThreshold({
    model: MerchantResourceUsage, docId: doc._id, path: 'notified.image', already: doc.notified?.image || [],
    used: doc.image.bytes, limit: limits.imageBandwidth.totalBytes, thresholds: th,
    label: 'Image bandwidth', tenantId, enabled: on && s.tracking.imageBandwidth,
  });
  await maybeNotifyThreshold({
    model: MerchantResourceUsage, docId: doc._id, path: 'notified.general', already: doc.notified?.general || [],
    used: doc.general.bytes, limit: limits.generalBandwidth.totalBytes, thresholds: th,
    label: 'General traffic', tenantId, enabled: on && s.tracking.generalTraffic,
  });
  const combinedUsed = doc.image.bytes + doc.general.bytes;
  await maybeNotifyThreshold({
    model: MerchantResourceUsage, docId: doc._id, path: 'notified.combined', already: doc.notified?.combined || [],
    used: combinedUsed, limit: limits.combined.totalBytes, thresholds: th,
    label: 'Combined bandwidth', tenantId, enabled: on && s.tracking.combinedBandwidth,
  });
};

/** Sends the "monthly allocation reset" notice the first time a new period doc is created. */
export const notifyPeriodReset = async (tenantId: Types.ObjectId, now = new Date()) => {
  const prev = await MerchantResourceUsage.exists({ tenantId, period: previousPeriodKey(now) });
  if (!prev) return;
  const limits = await getEffectiveLimits(tenantId);
  if (!limits.settings.notifications.onReset) return;
  await notifyTenantOwner(
    tenantId,
    'RESOURCE_RESET',
    'Monthly bandwidth allocation reset',
    `Your bandwidth allocation for ${periodKey(now)} has been renewed.`,
  );
};

/* ───────────────────────── merchant overview ───────────────────────── */
const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const rem = (limit: number, used: number): number | null => (limit > 0 ? Math.max(0, limit - used) : null);

export const getMerchantOverview = async (tenantId: string, period: string = periodKey()) => {
  const tid = oid(tenantId);
  const limits = await getEffectiveLimits(tid);
  const s = limits.settings;
  const th = s.warning.thresholds;
  const [state, usage, history, purchases] = await Promise.all([
    ensureStorageState(tid),
    MerchantResourceUsage.findOne({ tenantId: tid, period }).lean<any>(),
    MerchantResourceUsage.find({ tenantId: tid })
      .sort({ period: -1 })
      .limit(12)
      .select('period image general')
      .lean<any[]>(),
    ResourceAddonPurchase.find({ tenantId: tid, status: { $in: ['active', 'pending'] } })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<any[]>(),
  ]);

  const imgUsed = num(usage?.image?.bytes);
  const genUsed = num(usage?.general?.bytes);
  const combinedUsed = imgUsed + genUsed;
  const combinedLimit =
    limits.combined.totalBytes > 0
      ? limits.combined.totalBytes
      : limits.imageBandwidth.totalBytes > 0 && limits.generalBandwidth.totalBytes > 0
        ? limits.imageBandwidth.totalBytes + limits.generalBandwidth.totalBytes
        : 0;

  const hits = num(usage?.image?.cacheHit);
  const misses = num(usage?.image?.cacheMiss);
  const storageLimit = limits.storage.totalBytes;
  const storagePct = percentUsed(state.usedBytes, storageLimit);

  const daily = Object.entries(usage?.daily || {})
    .map(([d, v]: [string, any]) => ({
      date: `${period}-${d}`,
      imageBytes: num(v.imageBytes),
      imageRequests: num(v.imageRequests),
      generalBytes: num(v.generalBytes),
      generalRequests: num(v.generalRequests),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const mk = (key: string, label: string, used: number, limit: number, tracked: boolean) => {
    const percent = percentUsed(used, limit);
    return { key, label, percent, status: tracked ? statusForPercent(percent, limit, th) : 'unlimited' };
  };
  const warnings = [
    mk('storage', 'Image storage', state.usedBytes, storageLimit, s.tracking.storage),
    mk('imageBandwidth', 'Image bandwidth', imgUsed, limits.imageBandwidth.totalBytes, s.tracking.imageBandwidth),
    mk('generalBandwidth', 'General traffic', genUsed, limits.generalBandwidth.totalBytes, s.tracking.generalTraffic),
    mk('combined', 'Combined bandwidth', combinedUsed, combinedLimit, s.tracking.combinedBandwidth),
  ].filter((w) => ['info', 'warning', 'critical', 'limit_reached'].includes(w.status));

  return {
    period,
    generatedAt: new Date(),
    dataThrough: usage?.dataThrough || null,
    refreshIntervalMin: s.reportingIntervalMin,
    measurementNote:
      'Bandwidth is measured at the Cloudflare edge and aggregated in batches; figures are delayed (not real-time). Browser-cached responses never reach Cloudflare and are not counted.',
    package: { id: limits.packageId, name: limits.packageName, hasActiveSubscription: limits.hasActiveSubscription },
    tracking: s.tracking,
    policy: limits.policy,
    storage: {
      tracked: s.tracking.storage,
      baseBytes: limits.storage.baseBytes,
      addonBytes: limits.storage.addonBytes,
      limitBytes: storageLimit,
      usedBytes: state.usedBytes,
      remainingBytes: rem(storageLimit, state.usedBytes),
      fileCount: state.fileCount,
      percent: storagePct,
      overLimit: storageLimit > 0 && state.usedBytes > storageLimit,
    },
    imageBandwidth: {
      tracked: s.tracking.imageBandwidth,
      baseBytes: limits.imageBandwidth.baseBytes,
      addonBytes: limits.imageBandwidth.addonBytes,
      limitBytes: limits.imageBandwidth.totalBytes,
      usedBytes: imgUsed,
      remainingBytes: rem(limits.imageBandwidth.totalBytes, imgUsed),
      percent: percentUsed(imgUsed, limits.imageBandwidth.totalBytes),
      requests: num(usage?.image?.requests),
      cacheHit: hits,
      cacheMiss: misses,
      cacheHitRate: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 10000) / 100 : 0,
    },
    generalBandwidth: {
      tracked: s.tracking.generalTraffic,
      baseBytes: limits.generalBandwidth.baseBytes,
      addonBytes: limits.generalBandwidth.addonBytes,
      limitBytes: limits.generalBandwidth.totalBytes,
      usedBytes: genUsed,
      remainingBytes: rem(limits.generalBandwidth.totalBytes, genUsed),
      percent: percentUsed(genUsed, limits.generalBandwidth.totalBytes),
      requests: num(usage?.general?.requests),
    },
    combined: {
      tracked: s.tracking.combinedBandwidth,
      imageBytes: imgUsed,
      generalBytes: genUsed,
      usedBytes: combinedUsed,
      limitBytes: combinedLimit,
      remainingBytes: rem(combinedLimit, combinedUsed),
      percent: percentUsed(combinedUsed, combinedLimit),
    },
    daily,
    history: history.map((h) => ({
      period: h.period,
      imageBytes: num(h.image?.bytes),
      generalBytes: num(h.general?.bytes),
      imageRequests: num(h.image?.requests),
      generalRequests: num(h.general?.requests),
    })),
    warnings,
    activeAddons: purchases.map((p) => ({
      id: String(p._id),
      name: p.snapshot?.name,
      category: p.category,
      quantity: p.quantity,
      quantityBytes: p.quantityBytes * p.quantity,
      status: p.status,
      expiresAt: p.expiresAt,
    })),
  };
};
