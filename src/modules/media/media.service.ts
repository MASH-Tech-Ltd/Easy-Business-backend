import type { Request } from 'express';
import { Types } from 'mongoose';
import config from '../../config';
import CustomError from '../../helpers/CustomError';
import {
  DeleteContext,
  DeleteSummary,
  ImageLike,
  MediaProviderName,
  TrackedUpload,
  UploadContext,
  UploadedMedia,
} from './media.interface';
import { MediaAsset } from './media.model';
import { MediaUsage } from './mediaUsage.model';
import { getProvider, getUploadProvider, resolveProvider } from './providers';
import { removeTempFile } from './providers/cloudinary.provider';
import { buildOwnerPrefix, expandWithVariantKeys, isKeyOwnedBy, isSafeKey } from './utils/mediaKey';
import { Product } from '../product/product.model';
import { Category } from '../category/category.model';
import { Theme } from '../theme/theme.model';
import { User } from '../auth/auth.model';
import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';

export const getCurrentMonthKey = (date: Date = new Date()): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const toObjectIdOrNull = (tenantId: string | null | undefined): Types.ObjectId | null => {
  if (!tenantId) return null;
  if (!Types.ObjectId.isValid(String(tenantId))) return null;
  return new Types.ObjectId(String(tenantId));
};

const recordUploadUsage = async (
  tenantId: string | null | undefined,
  provider: MediaProviderName,
  bytes: number,
): Promise<void> => {
  const month = getCurrentMonthKey();
  const tid = toObjectIdOrNull(tenantId);
  try {
    await MediaUsage.updateOne(
      { tenantId: tid, month, provider },
      {
        $inc: { uploadCount: 1, uploadBytes: Math.max(0, bytes) },
        $setOnInsert: { tenantId: tid, month, provider, deliverySource: 'none' },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error('[media] Failed to update upload usage counter:', err);
  }
};

const recordDeleteUsage = async (
  tenantId: Types.ObjectId | null,
  provider: MediaProviderName,
  count: number,
  bytes: number,
): Promise<void> => {
  if (count <= 0) return;
  const month = getCurrentMonthKey();
  try {
    await MediaUsage.updateOne(
      { tenantId, month, provider },
      {
        $inc: { deleteCount: count, deletedBytes: Math.max(0, bytes) },
        $setOnInsert: { tenantId, month, provider, deliverySource: 'none' },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error('[media] Failed to update delete usage counter:', err);
  }
};

const MEDIA_ADDON_SLUGS = new Set(['media_storage_boost', 'extra_media_storage']);
const BYTES_PER_GB = 1024 * 1024 * 1024;

export interface MerchantMediaQuota {
  baseLimitBytes: number;
  addonLimitBytes: number;
  totalLimitBytes: number;
  usedBytes: number;
  remainingBytes: number;
  usedPercent: number;
  isLimitReached: boolean;
}

export const computeQuotaSummary = (
  usedBytes: number,
  baseLimitBytes: number,
  addonLimitBytes: number,
): MerchantMediaQuota => {
  const totalLimitBytes = Math.max(0, baseLimitBytes + addonLimitBytes);
  const safeUsed = Math.max(0, usedBytes);
  const remainingBytes = totalLimitBytes > 0 ? Math.max(0, totalLimitBytes - safeUsed) : 0;
  const usedPercent =
    totalLimitBytes > 0 ? Math.min(100, Math.round((safeUsed / totalLimitBytes) * 10000) / 100) : 0;
  const isLimitReached = totalLimitBytes > 0 && safeUsed >= totalLimitBytes;
  return {
    baseLimitBytes,
    addonLimitBytes,
    totalLimitBytes,
    usedBytes: safeUsed,
    remainingBytes,
    usedPercent,
    isLimitReached,
  };
};

const getMerchantMediaQuota = async (tenantId: string): Promise<MerchantMediaQuota> => {
  const tid = new Types.ObjectId(tenantId);
  const baseLimitBytes = config.media.merchantStorageLimitBytes;

  const [usageAgg, subscription] = await Promise.all([
    MediaAsset.aggregate([
      { $match: { tenantId: tid, status: 'active' } },
      { $group: { _id: null, totalBytes: { $sum: '$totalBytes' } } },
    ]),
    Subscription.findOne({ tenantId: tid, status: 'active' })
      .populate('purchasedAddons.addonId', 'slug')
      .select('purchasedAddons')
      .lean(),
  ]);

  const usedBytes = usageAgg[0]?.totalBytes || 0;
  let addonGb = 0;
  if (subscription?.purchasedAddons && Array.isArray(subscription.purchasedAddons)) {
    for (const pa of subscription.purchasedAddons as any[]) {
      const slug = pa?.addonId?.slug;
      if (slug && MEDIA_ADDON_SLUGS.has(slug)) {
        addonGb += Math.max(0, Number(pa.limit) || 0);
      }
    }
  }

  return computeQuotaSummary(usedBytes, baseLimitBytes, addonGb * BYTES_PER_GB);
};

export interface ExtendedDeleteContext extends DeleteContext {
  /** Only set by super_admin cascade operations (e.g. deleteTenant). */
  allowAnyTenant?: boolean;
}

/**
 * Uploads an image via the configured active provider, tracks it on `req.uploadedMedia`
 * for failure rollback, and persists a `MediaAsset` record + usage counter.
 *
 * Enforces per-merchant storage quota (default 2 GB + storage add-ons) before uploading.
 * If MongoDB persistence fails after the storage upload succeeds, the newly uploaded
 * object is deleted from the provider before rethrowing so no orphan remains.
 */
const uploadImage = async (
  req: Request | null | undefined,
  filePath: string,
  context: UploadContext,
): Promise<UploadedMedia> => {
  const ownerPrefix = buildOwnerPrefix(context.tenantId);

  if (context.tenantId) {
    const quota = await getMerchantMediaQuota(String(context.tenantId));
    if (quota.isLimitReached) {
      removeTempFile(filePath);
      throw new CustomError(
        403,
        'MEDIA_STORAGE_LIMIT_REACHED: You have reached your image storage limit. Please delete unused images or purchase a storage add-on.',
      );
    }
  }

  const provider = getUploadProvider();

  const uploaded = await provider.upload({
    filePath,
    kind: context.kind,
    ownerPrefix,
  });

  // Track immediately on the request so any downstream failure cleans up the object
  if (req) {
    if (!Array.isArray(req.uploadedMedia)) req.uploadedMedia = [];
    req.uploadedMedia.push({
      provider: uploaded.provider,
      public_id: uploaded.public_id,
      secure_url: uploaded.secure_url,
      tenantId: context.tenantId ? String(context.tenantId) : null,
    });
  }

  const tid = toObjectIdOrNull(context.tenantId);
  const totalBytes = uploaded.totalBytes ?? uploaded.bytes ?? 0;

  try {
    await MediaAsset.create({
      tenantId: tid,
      provider: uploaded.provider,
      key: uploaded.public_id,
      publicUrl: uploaded.secure_url,
      kind: context.kind,
      mimeType: uploaded.mimeType,
      bytes: uploaded.bytes ?? 0,
      totalBytes,
      width: uploaded.width,
      height: uploaded.height,
      variants: uploaded.variants,
      status: 'active',
    });
  } catch (dbErr) {
    // Compensating delete: remove the just-uploaded object so it does not become an orphan
    const keysToRemove =
      uploaded.provider === 'r2' ? expandWithVariantKeys(uploaded.public_id) : [uploaded.public_id];
    await provider.delete(keysToRemove).catch((delErr) => {
      console.error('[media] Compensating delete failed after DB error:', delErr);
    });
    throw dbErr;
  }

  await recordUploadUsage(context.tenantId, uploaded.provider, totalBytes);

  return uploaded;
};

/**
 * Provider-aware, ownership-checked deletion for one or more image references.
 * Never throws; failed deletions are marked `pending_delete` in `MediaAsset` for retry.
 */
const deleteImages = async (
  images: ImageLike[],
  context: ExtendedDeleteContext,
): Promise<DeleteSummary> => {
  const summary: DeleteSummary = {
    requested: images.length,
    deleted: 0,
    skipped: 0,
    refused: 0,
    queuedForRetry: 0,
  };

  if (!images || images.length === 0) return summary;

  const cloudinaryIds: string[] = [];
  const r2MainKeys: string[] = [];

  for (const img of images) {
    const resolved = resolveProvider(img);
    if (resolved.provider === 'external' || !resolved.id) {
      summary.skipped++;
      continue;
    }

    if (resolved.provider === 'r2') {
      if (!isSafeKey(resolved.id)) {
        summary.refused++;
        continue;
      }
      if (!context.allowAnyTenant && !isKeyOwnedBy(resolved.id, context.tenantId)) {
        console.warn(
          `[media:security] Refused cross-tenant R2 delete attempt: key=${resolved.id} callerTenant=${context.tenantId ?? 'platform'}`,
        );
        summary.refused++;
        continue;
      }
      r2MainKeys.push(resolved.id);
    } else {
      cloudinaryIds.push(resolved.id);
    }
  }

  // 1. Delete Cloudinary objects
  if (cloudinaryIds.length > 0) {
    const uniqueCl = Array.from(new Set(cloudinaryIds));
    const res = await getProvider('cloudinary').delete(uniqueCl);
    summary.deleted += res.deleted.length;

    if (res.deleted.length > 0) {
      const assets = await MediaAsset.find({
        provider: 'cloudinary',
        key: { $in: res.deleted },
        status: { $ne: 'deleted' },
      }).lean();
      await MediaAsset.updateMany(
        { provider: 'cloudinary', key: { $in: res.deleted } },
        { $set: { status: 'deleted', deletedAt: new Date() } },
      );
      const byTenant = new Map<string, { tid: Types.ObjectId | null; count: number; bytes: number }>();
      for (const a of assets) {
        const k = a.tenantId ? a.tenantId.toString() : 'platform';
        const cur = byTenant.get(k) || { tid: a.tenantId ?? null, count: 0, bytes: 0 };
        cur.count++;
        cur.bytes += a.totalBytes || a.bytes || 0;
        byTenant.set(k, cur);
      }
      for (const entry of byTenant.values()) {
        await recordDeleteUsage(entry.tid, 'cloudinary', entry.count, entry.bytes);
      }
    }

    if (res.failed.length > 0) {
      summary.queuedForRetry += res.failed.length;
      for (const f of res.failed) {
        await MediaAsset.updateOne(
          { provider: 'cloudinary', key: f.id },
          {
            $set: { status: 'pending_delete', lastError: f.error },
            $inc: { deleteAttempts: 1 },
          },
        ).catch(() => {});
      }
    }
  }

  // 2. Delete R2 objects (including variants)
  if (r2MainKeys.length > 0) {
    const uniqueMainKeys = Array.from(new Set(r2MainKeys));
    const allKeysToDelete = Array.from(
      new Set(uniqueMainKeys.flatMap((k) => expandWithVariantKeys(k))),
    );
    const res = await getProvider('r2').delete(allKeysToDelete);
    const failedSet = new Set(res.failed.map((f) => f.id));

    const deletedMainKeys: string[] = [];
    const failedMainKeys: Array<{ id: string; error: string }> = [];

    for (const mainKey of uniqueMainKeys) {
      const related = expandWithVariantKeys(mainKey);
      const failure = res.failed.find((f) => related.includes(f.id));
      if (failure && failedSet.has(failure.id)) {
        failedMainKeys.push({ id: mainKey, error: failure.error });
      } else {
        deletedMainKeys.push(mainKey);
      }
    }

    summary.deleted += deletedMainKeys.length;

    if (deletedMainKeys.length > 0) {
      const assets = await MediaAsset.find({
        provider: 'r2',
        key: { $in: deletedMainKeys },
        status: { $ne: 'deleted' },
      }).lean();
      await MediaAsset.updateMany(
        { provider: 'r2', key: { $in: deletedMainKeys } },
        { $set: { status: 'deleted', deletedAt: new Date() } },
      );
      const byTenant = new Map<string, { tid: Types.ObjectId | null; count: number; bytes: number }>();
      for (const a of assets) {
        const k = a.tenantId ? a.tenantId.toString() : 'platform';
        const cur = byTenant.get(k) || { tid: a.tenantId ?? null, count: 0, bytes: 0 };
        cur.count++;
        cur.bytes += a.totalBytes || a.bytes || 0;
        byTenant.set(k, cur);
      }
      for (const entry of byTenant.values()) {
        await recordDeleteUsage(entry.tid, 'r2', entry.count, entry.bytes);
      }
    }

    if (failedMainKeys.length > 0) {
      summary.queuedForRetry += failedMainKeys.length;
      for (const f of failedMainKeys) {
        await MediaAsset.updateOne(
          { provider: 'r2', key: f.id },
          {
            $set: { status: 'pending_delete', lastError: f.error },
            $inc: { deleteAttempts: 1 },
          },
        ).catch(() => {});
      }
    }
  }

  return summary;
};

/**
 * Deletes only server-tracked uploads from a failed/aborted request.
 * Never trusts req.body for image IDs (prevents cross-tenant IDOR deletion).
 */
const cleanupTrackedUploads = async (tracked: TrackedUpload[]): Promise<void> => {
  if (!tracked || tracked.length === 0) return;
  const byTenant = new Map<string, TrackedUpload[]>();
  for (const item of tracked) {
    const k = item.tenantId ?? '__platform__';
    const arr = byTenant.get(k) || [];
    arr.push(item);
    byTenant.set(k, arr);
  }
  for (const [k, items] of byTenant.entries()) {
    const tenantId = k === '__platform__' ? null : k;
    await deleteImages(
      items.map((i) => ({ provider: i.provider, public_id: i.public_id, secure_url: i.secure_url })),
      { tenantId, reason: 'request_failure_cleanup' },
    );
  }
};

/** Retries pending_delete assets (up to 10 attempts). Called by media.cron.ts. */
const retryPendingDeletes = async (limit: number = 50): Promise<{ retried: number; deleted: number }> => {
  const pending = await MediaAsset.find({
    status: 'pending_delete',
    deleteAttempts: { $lt: 10 },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  if (pending.length === 0) return { retried: 0, deleted: 0 };

  let deleted = 0;
  for (const asset of pending) {
    const res = await deleteImages(
      [{ provider: asset.provider, public_id: asset.key, secure_url: asset.publicUrl }],
      { tenantId: asset.tenantId ? asset.tenantId.toString() : null, allowAnyTenant: true, reason: 'cron_retry' },
    );
    deleted += res.deleted;
  }
  return { retried: pending.length, deleted };
};

const isCloudinaryUrl = (url?: string | null): boolean =>
  Boolean(url && (url.includes('cloudinary.com') || url.includes('cdn.masheco.com')));

/** Counts legacy Cloudinary images embedded in business documents for a tenant. */
const countLegacyCloudinaryImagesForTenant = async (tenantId: string): Promise<number> => {
  const tid = new Types.ObjectId(tenantId);
  const [products, categories, theme, tenant, users] = await Promise.all([
    Product.find({ tenantId: tid }).select('images.secure_url images.provider').lean(),
    Category.find({ tenantId: tid }).select('image.secure_url image.provider').lean(),
    Theme.findOne({ tenantId: tid }).select('banner.images banner.image').lean(),
    Tenant.findById(tid).select('logo').lean(),
    User.find({ tenantId: tid }).select('avatar.secure_url avatar.provider').lean(),
  ]);

  let count = 0;
  for (const p of products) {
    for (const img of p.images || []) {
      if ((img as any).provider !== 'r2' && isCloudinaryUrl(img.secure_url)) count++;
    }
  }
  for (const c of categories) {
    if ((c.image as any)?.provider !== 'r2' && isCloudinaryUrl(c.image?.secure_url)) count++;
  }
  if (theme?.banner) {
    const seen = new Set<string>();
    for (const img of theme.banner.images || []) {
      if ((img as any).provider !== 'r2' && isCloudinaryUrl(img.secure_url) && !seen.has(img.secure_url)) {
        seen.add(img.secure_url);
        count++;
      }
    }
    if (
      theme.banner.image?.secure_url &&
      (theme.banner.image as any).provider !== 'r2' &&
      isCloudinaryUrl(theme.banner.image.secure_url) &&
      !seen.has(theme.banner.image.secure_url)
    ) {
      count++;
    }
  }
  if (isCloudinaryUrl(tenant?.logo)) count++;
  for (const u of users) {
    if ((u.avatar as any)?.provider !== 'r2' && isCloudinaryUrl(u.avatar?.secure_url)) count++;
  }
  return count;
};

const getMerchantUsage = async (tenantId: string, month: string = getCurrentMonthKey()) => {
  const tid = new Types.ObjectId(tenantId);

  const [assetAgg, monthlyUsage, legacyCloudinaryCount, quota] = await Promise.all([
    MediaAsset.aggregate([
      { $match: { tenantId: tid, status: 'active' } },
      {
        $group: {
          _id: '$provider',
          imageCount: { $sum: 1 },
          mainBytes: { $sum: '$bytes' },
          totalBytes: { $sum: '$totalBytes' },
        },
      },
    ]),
    MediaUsage.find({ tenantId: tid, month }).lean(),
    countLegacyCloudinaryImagesForTenant(tenantId),
    getMerchantMediaQuota(tenantId),
  ]);

  const byProvider: Record<MediaProviderName, { imageCount: number; mainBytes: number; totalBytes: number }> = {
    r2: { imageCount: 0, mainBytes: 0, totalBytes: 0 },
    cloudinary: { imageCount: 0, mainBytes: 0, totalBytes: 0 },
  };

  for (const row of assetAgg) {
    if (row._id === 'r2' || row._id === 'cloudinary') {
      byProvider[row._id as MediaProviderName] = {
        imageCount: row.imageCount,
        mainBytes: row.mainBytes,
        totalBytes: row.totalBytes,
      };
    }
  }

  const r2Monthly = monthlyUsage.find((u) => u.provider === 'r2');
  const clMonthly = monthlyUsage.find((u) => u.provider === 'cloudinary');
  const uploadCount = (r2Monthly?.uploadCount || 0) + (clMonthly?.uploadCount || 0);
  const deleteCount = (r2Monthly?.deleteCount || 0) + (clMonthly?.deleteCount || 0);

  return {
    month,
    activeProvider: getUploadProvider().name,
    quota,
    writes: {
      uploadCount,
      deleteCount,
      totalOperations: uploadCount + deleteCount,
      r2WriteObjects: ((r2Monthly?.uploadCount || 0) + (r2Monthly?.deleteCount || 0)) * 3,
      uploadBytes: (r2Monthly?.uploadBytes || 0) + (clMonthly?.uploadBytes || 0),
    },
    reads: {
      totalRequests: r2Monthly?.deliveryRequests ?? null,
      totalBytes: r2Monthly?.deliveryBytes ?? null,
      source: r2Monthly?.deliverySource ?? 'none',
      updatedAt: r2Monthly?.deliveryUpdatedAt ?? null,
    },
    storage: {
      r2: byProvider.r2,
      cloudinaryTracked: byProvider.cloudinary,
      legacyCloudinaryImageCount: legacyCloudinaryCount,
      totalTrackedBytes: byProvider.r2.totalBytes + byProvider.cloudinary.totalBytes,
      totalImageCount: byProvider.r2.imageCount + Math.max(byProvider.cloudinary.imageCount, legacyCloudinaryCount),
    },
    monthly: {
      uploadCount: (r2Monthly?.uploadCount || 0) + (clMonthly?.uploadCount || 0),
      uploadBytes: (r2Monthly?.uploadBytes || 0) + (clMonthly?.uploadBytes || 0),
      deleteCount: (r2Monthly?.deleteCount || 0) + (clMonthly?.deleteCount || 0),
      deletedBytes: (r2Monthly?.deletedBytes || 0) + (clMonthly?.deletedBytes || 0),
      deliveryRequests: r2Monthly?.deliveryRequests ?? null,
      deliveryBytes: r2Monthly?.deliveryBytes ?? null,
      deliverySource: r2Monthly?.deliverySource ?? 'none',
    },
  };
};

const getPlatformUsage = async (month: string = getCurrentMonthKey()) => {
  const [providerStorageAgg, tenantStorageAgg, monthlyAgg, tenantMonthlyAgg] = await Promise.all([
    MediaAsset.aggregate([
      { $match: { status: 'active' } },
      {
        $group: {
          _id: '$provider',
          imageCount: { $sum: 1 },
          mainBytes: { $sum: '$bytes' },
          totalBytes: { $sum: '$totalBytes' },
        },
      },
    ]),
    MediaAsset.aggregate([
      { $match: { status: 'active', tenantId: { $ne: null } } },
      {
        $group: {
          _id: { tenantId: '$tenantId', provider: '$provider' },
          imageCount: { $sum: 1 },
          totalBytes: { $sum: '$totalBytes' },
        },
      },
    ]),
    MediaUsage.aggregate([
      { $match: { month } },
      {
        $group: {
          _id: '$provider',
          uploadCount: { $sum: '$uploadCount' },
          uploadBytes: { $sum: '$uploadBytes' },
          deleteCount: { $sum: '$deleteCount' },
          deletedBytes: { $sum: '$deletedBytes' },
        },
      },
    ]),
    MediaUsage.find({ month, tenantId: { $ne: null } }).lean(),
  ]);

  const byProvider: Record<MediaProviderName, { imageCount: number; mainBytes: number; totalBytes: number }> = {
    r2: { imageCount: 0, mainBytes: 0, totalBytes: 0 },
    cloudinary: { imageCount: 0, mainBytes: 0, totalBytes: 0 },
  };
  for (const row of providerStorageAgg) {
    if (row._id === 'r2' || row._id === 'cloudinary') {
      byProvider[row._id as MediaProviderName] = {
        imageCount: row.imageCount,
        mainBytes: row.mainBytes,
        totalBytes: row.totalBytes,
      };
    }
  }

  const tenantMap = new Map<
    string,
    {
      tenantId: string;
      r2Images: number;
      r2Bytes: number;
      cloudinaryImages: number;
      cloudinaryBytes: number;
      monthlyUploadCount: number;
      monthlyUploadBytes: number;
      monthlyDeleteCount: number;
      monthlyWriteOps: number;
      monthlyReadRequests: number | null;
      monthlyReadBytes: number | null;
    }
  >();

  const emptyMerchantRow = (tid: string) => ({
    tenantId: tid,
    r2Images: 0,
    r2Bytes: 0,
    cloudinaryImages: 0,
    cloudinaryBytes: 0,
    monthlyUploadCount: 0,
    monthlyUploadBytes: 0,
    monthlyDeleteCount: 0,
    monthlyWriteOps: 0,
    monthlyReadRequests: null as number | null,
    monthlyReadBytes: null as number | null,
  });

  for (const row of tenantStorageAgg) {
    const tid = row._id.tenantId.toString();
    const cur = tenantMap.get(tid) || emptyMerchantRow(tid);
    if (row._id.provider === 'r2') {
      cur.r2Images = row.imageCount;
      cur.r2Bytes = row.totalBytes;
    } else {
      cur.cloudinaryImages = row.imageCount;
      cur.cloudinaryBytes = row.totalBytes;
    }
    tenantMap.set(tid, cur);
  }

  let platformReadRequests = 0;
  let platformReadBytes = 0;
  let hasReadMetrics = false;

  for (const row of tenantMonthlyAgg) {
    if (!row.tenantId) continue;
    const tid = row.tenantId.toString();
    const cur = tenantMap.get(tid) || emptyMerchantRow(tid);
    cur.monthlyUploadCount += row.uploadCount || 0;
    cur.monthlyUploadBytes += row.uploadBytes || 0;
    cur.monthlyDeleteCount += row.deleteCount || 0;
    cur.monthlyWriteOps = cur.monthlyUploadCount + cur.monthlyDeleteCount;
    if (row.deliveryRequests !== null && row.deliveryRequests !== undefined) {
      cur.monthlyReadRequests = (cur.monthlyReadRequests || 0) + row.deliveryRequests;
      platformReadRequests += row.deliveryRequests;
      hasReadMetrics = true;
    }
    if (row.deliveryBytes !== null && row.deliveryBytes !== undefined) {
      cur.monthlyReadBytes = (cur.monthlyReadBytes || 0) + row.deliveryBytes;
      platformReadBytes += row.deliveryBytes;
      hasReadMetrics = true;
    }
    tenantMap.set(tid, cur);
  }

  const tenantIds = Array.from(tenantMap.keys()).map((id) => new Types.ObjectId(id));
  const tenants = tenantIds.length
    ? await Tenant.find({ _id: { $in: tenantIds } }).select('name slug').lean()
    : [];
  const tenantInfoMap = new Map(tenants.map((t: any) => [t._id.toString(), t]));
  const baseLimitBytes = config.media.merchantStorageLimitBytes;

  const merchants = Array.from(tenantMap.values())
    .map((m) => {
      const info: any = tenantInfoMap.get(m.tenantId);
      const totalBytes = m.r2Bytes + m.cloudinaryBytes;
      return {
        ...m,
        storeName: info?.name || 'Unknown Store',
        slug: info?.slug || '',
        totalBytes,
        totalImages: m.r2Images + m.cloudinaryImages,
        baseLimitBytes,
      };
    })
    .sort((a, b) => b.totalBytes - a.totalBytes);

  return {
    month,
    activeProvider: getUploadProvider().name,
    storage: {
      r2: byProvider.r2,
      cloudinaryTracked: byProvider.cloudinary,
      totalTrackedBytes: byProvider.r2.totalBytes + byProvider.cloudinary.totalBytes,
      totalTrackedImages: byProvider.r2.imageCount + byProvider.cloudinary.imageCount,
    },
    reads: {
      totalRequests: hasReadMetrics ? platformReadRequests : null,
      totalBytes: hasReadMetrics ? platformReadBytes : null,
    },
    monthly: monthlyAgg,
    merchants,
  };
};

export const MediaService = {
  uploadImage,
  deleteImages,
  cleanupTrackedUploads,
  retryPendingDeletes,
  getMerchantUsage,
  getPlatformUsage,
};
