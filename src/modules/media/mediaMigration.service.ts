import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import CustomError from '../../helpers/CustomError';
import { Product } from '../product/product.model';
import { Category } from '../category/category.model';
import { Theme } from '../theme/theme.model';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../auth/auth.model';
import { MediaAsset } from './media.model';
import { MediaMigrationBackup, MigrationKind } from './mediaMigration.model';
import { getProvider, resolveProvider } from './providers';
import { buildOwnerPrefix } from './utils/mediaKey';
import { recordUploadUsage } from './media.service';
import { reconcileStorage } from '../resource/resource.usage.service';

const ALL_KINDS: MigrationKind[] = ['product', 'category', 'banner', 'logo', 'avatar'];
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

const isCloudinaryImg = (img: { public_id?: string | null; secure_url?: string | null; provider?: string | null } | null | undefined) => {
  if (!img || (!img.secure_url && !img.public_id)) return false;
  return resolveProvider(img).provider === 'cloudinary';
};

const downloadToTemp = async (rawUrl: string): Promise<string> => {
  const res = await axios.get<ArrayBuffer>(rawUrl, { responseType: 'arraybuffer', timeout: 25000 });
  const tmpPath = path.join(os.tmpdir(), `masheco-mig-${randomUUID()}`);
  await fs.writeFile(tmpPath, Buffer.from(res.data));
  return tmpPath;
};

const uploadOneToR2 = async (
  tenantId: string,
  kind: MigrationKind,
  oldImg: { public_id?: string | null; secure_url?: string | null },
  entityId: Types.ObjectId,
) => {
  const url = oldImg.secure_url || '';
  if (!url) throw new Error('Missing source URL');
  const tmp = await downloadToTemp(url);
  const r2 = getProvider('r2');
  const uploaded = await r2.upload({
    filePath: tmp,
    kind,
    ownerPrefix: buildOwnerPrefix(tenantId),
  });
  const totalBytes = uploaded.totalBytes ?? uploaded.bytes ?? 0;
  await MediaAsset.create({
    tenantId: new Types.ObjectId(tenantId),
    provider: 'r2',
    key: uploaded.public_id,
    publicUrl: uploaded.secure_url,
    kind,
    mimeType: uploaded.mimeType,
    bytes: uploaded.bytes ?? 0,
    totalBytes,
    width: uploaded.width,
    height: uploaded.height,
    variants: uploaded.variants,
    status: 'active',
  });
  await recordUploadUsage(tenantId, 'r2', totalBytes);

  const oldPublicId = resolveProvider(oldImg).id || oldImg.public_id || '';
  const now = new Date();
  await MediaMigrationBackup.create({
    tenantId: new Types.ObjectId(tenantId),
    kind,
    entityId,
    oldPublicId,
    oldSecureUrl: url,
    newKey: uploaded.public_id,
    newSecureUrl: uploaded.secure_url,
    status: 'migrated',
    migratedAt: now,
    cleanupEligibleAt: new Date(now.getTime() + THREE_DAYS_MS),
  });
  return uploaded;
};

export const scanTenantCloudinaryMedia = async (tenantId: string) => {
  const tid = new Types.ObjectId(tenantId);
  const [products, categories, theme, tenant, users, backups] = await Promise.all([
    Product.find({ tenantId: tid }).select('images').lean<any[]>(),
    Category.find({ tenantId: tid }).select('image').lean<any[]>(),
    Theme.findOne({ tenantId: tid }).select('banner').lean<any>(),
    Tenant.findById(tid).select('name slug logo').lean<any>(),
    User.find({ tenantId: tid }).select('avatar').lean<any[]>(),
    MediaMigrationBackup.find({ tenantId: tid, status: 'migrated' }).select('cleanupEligibleAt').lean<any[]>(),
  ]);
  if (!tenant) throw new CustomError(404, 'Store not found');

  let productCount = 0;
  for (const p of products) for (const img of p.images || []) if (isCloudinaryImg(img)) productCount++;

  let categoryCount = 0;
  for (const c of categories) if (isCloudinaryImg(c.image)) categoryCount++;

  let bannerCount = 0;
  if (theme?.banner) {
    if (isCloudinaryImg(theme.banner.image)) bannerCount++;
    for (const img of theme.banner.images || []) if (isCloudinaryImg(img)) bannerCount++;
  }

  const logoCount = tenant.logo && isCloudinaryImg({ secure_url: tenant.logo }) ? 1 : 0;

  let avatarCount = 0;
  for (const u of users) if (isCloudinaryImg(u.avatar)) avatarCount++;

  const now = Date.now();
  const eligibleCleanup = backups.filter((b) => new Date(b.cleanupEligibleAt).getTime() <= now).length;

  return {
    tenant: { id: String(tenant._id), name: tenant.name, slug: tenant.slug },
    r2Configured: getProvider('r2').isConfigured(),
    counts: {
      product: productCount,
      category: categoryCount,
      banner: bannerCount,
      logo: logoCount,
      avatar: avatarCount,
      total: productCount + categoryCount + bannerCount + logoCount + avatarCount,
    },
    backups: {
      pendingCleanup: backups.length,
      eligibleNow: eligibleCleanup,
      waitingThreeDays: backups.length - eligibleCleanup,
    },
  };
};

const emitMigrationProgress = (
  actorUserId: string | null | undefined,
  payload: {
    tenantId: string;
    kind: MigrationKind;
    status: 'migrated' | 'failed';
    url?: string;
    error?: string;
  },
) => {
  try {
    const io = require('../../socket').getIO();
    if (actorUserId) io.to(`user_${actorUserId}`).emit('media_migration_progress', payload);
    else io.emit('media_migration_progress', payload);
  } catch {
    // socket optional in tests/CLI
  }
};

export const migrateTenantMediaToR2 = async (
  tenantId: string,
  kindsInput: MigrationKind[] = ALL_KINDS,
  batchLimit: number = 10,
  actorUserId?: string | null,
) => {
  if (!getProvider('r2').isConfigured()) {
    throw new CustomError(400, 'Cloudflare R2 is not configured on the backend');
  }
  const kinds = new Set<MigrationKind>(kindsInput.filter((k) => ALL_KINDS.includes(k)));
  if (!kinds.size) throw new CustomError(400, 'Select at least one image category to migrate');

  const limit = Math.max(1, Math.min(50, Number(batchLimit) || 10));
  const tid = new Types.ObjectId(tenantId);
  const summary = {
    migrated: 0,
    failed: 0,
    processed: 0,
    byKind: { product: 0, category: 0, banner: 0, logo: 0, avatar: 0 },
    errors: [] as string[],
  };
  const hasRoom = () => summary.processed < limit;

  if (kinds.has('product') && hasRoom()) {
    const products = await Product.find({ tenantId: tid });
    for (const p of products) {
      if (!hasRoom()) break;
      let changed = false;
      for (let i = 0; i < (p.images || []).length; i++) {
        if (!hasRoom()) break;
        const img = p.images[i];
        if (!isCloudinaryImg(img)) continue;
        summary.processed++;
        try {
          const up = await uploadOneToR2(tenantId, 'product', img!, p._id as Types.ObjectId);
          p.images[i] = { public_id: up.public_id, secure_url: up.secure_url, provider: 'r2' } as any;
          changed = true;
          summary.migrated++;
          summary.byKind.product++;
          emitMigrationProgress(actorUserId, { tenantId, kind: 'product', status: 'migrated', url: up.secure_url });
        } catch (err: any) {
          summary.failed++;
          const msg = `product ${p._id}: ${err?.message || 'failed'}`;
          summary.errors.push(msg);
          emitMigrationProgress(actorUserId, { tenantId, kind: 'product', status: 'failed', error: msg });
        }
      }
      if (changed) await p.save();
    }
  }

  if (kinds.has('category') && hasRoom()) {
    const categories = await Category.find({ tenantId: tid });
    for (const c of categories) {
      if (!hasRoom()) break;
      if (!isCloudinaryImg(c.image)) continue;
      summary.processed++;
      try {
        const up = await uploadOneToR2(tenantId, 'category', c.image!, c._id as Types.ObjectId);
        c.image = { public_id: up.public_id, secure_url: up.secure_url, provider: 'r2' } as any;
        await c.save();
        summary.migrated++;
        summary.byKind.category++;
        emitMigrationProgress(actorUserId, { tenantId, kind: 'category', status: 'migrated', url: up.secure_url });
      } catch (err: any) {
        summary.failed++;
        const msg = `category ${c._id}: ${err?.message || 'failed'}`;
        summary.errors.push(msg);
        emitMigrationProgress(actorUserId, { tenantId, kind: 'category', status: 'failed', error: msg });
      }
    }
  }

  if (kinds.has('banner') && hasRoom()) {
    const theme = await Theme.findOne({ tenantId: tid });
    if (theme?.banner) {
      let changed = false;
      if (isCloudinaryImg(theme.banner.image) && hasRoom()) {
        summary.processed++;
        try {
          const up = await uploadOneToR2(tenantId, 'banner', theme.banner.image!, theme._id as Types.ObjectId);
          theme.banner.image = { public_id: up.public_id, secure_url: up.secure_url, provider: 'r2' };
          changed = true;
          summary.migrated++;
          summary.byKind.banner++;
          emitMigrationProgress(actorUserId, { tenantId, kind: 'banner', status: 'migrated', url: up.secure_url });
        } catch (err: any) {
          summary.failed++;
          const msg = `banner main: ${err?.message || 'failed'}`;
          summary.errors.push(msg);
          emitMigrationProgress(actorUserId, { tenantId, kind: 'banner', status: 'failed', error: msg });
        }
      }
      for (let i = 0; i < (theme.banner.images || []).length; i++) {
        if (!hasRoom()) break;
        const img = theme.banner.images![i];
        if (!isCloudinaryImg(img)) continue;
        summary.processed++;
        try {
          const up = await uploadOneToR2(tenantId, 'banner', img!, theme._id as Types.ObjectId);
          theme.banner.images![i] = { public_id: up.public_id, secure_url: up.secure_url, provider: 'r2' };
          changed = true;
          summary.migrated++;
          summary.byKind.banner++;
          emitMigrationProgress(actorUserId, { tenantId, kind: 'banner', status: 'migrated', url: up.secure_url });
        } catch (err: any) {
          summary.failed++;
          const msg = `banner[${i}]: ${err?.message || 'failed'}`;
          summary.errors.push(msg);
          emitMigrationProgress(actorUserId, { tenantId, kind: 'banner', status: 'failed', error: msg });
        }
      }
      if (changed) await theme.save();
    }
  }

  if (kinds.has('logo') && hasRoom()) {
    const tenant = await Tenant.findById(tid);
    if (tenant?.logo && isCloudinaryImg({ secure_url: tenant.logo })) {
      summary.processed++;
      try {
        const up = await uploadOneToR2(tenantId, 'logo', { secure_url: tenant.logo }, tenant._id as Types.ObjectId);
        tenant.logo = up.secure_url;
        await tenant.save();
        summary.migrated++;
        summary.byKind.logo++;
        emitMigrationProgress(actorUserId, { tenantId, kind: 'logo', status: 'migrated', url: up.secure_url });
      } catch (err: any) {
        summary.failed++;
        const msg = `logo: ${err?.message || 'failed'}`;
        summary.errors.push(msg);
        emitMigrationProgress(actorUserId, { tenantId, kind: 'logo', status: 'failed', error: msg });
      }
    }
  }

  if (kinds.has('avatar') && hasRoom()) {
    const users = await User.find({ tenantId: tid });
    for (const u of users) {
      if (!hasRoom()) break;
      if (!isCloudinaryImg(u.avatar)) continue;
      summary.processed++;
      try {
        const up = await uploadOneToR2(tenantId, 'avatar', u.avatar!, u._id as Types.ObjectId);
        u.avatar = { public_id: up.public_id, secure_url: up.secure_url, provider: 'r2' } as any;
        await u.save();
        summary.migrated++;
        summary.byKind.avatar++;
        emitMigrationProgress(actorUserId, { tenantId, kind: 'avatar', status: 'migrated', url: up.secure_url });
      } catch (err: any) {
        summary.failed++;
        const msg = `avatar ${u._id}: ${err?.message || 'failed'}`;
        summary.errors.push(msg);
        emitMigrationProgress(actorUserId, { tenantId, kind: 'avatar', status: 'failed', error: msg });
      }
    }
  }

  await reconcileStorage(tid).catch(() => {});
  const remainingScan = await scanTenantCloudinaryMedia(tenantId);
  const remaining = Array.from(kinds).reduce((sum, k) => sum + (remainingScan.counts[k] || 0), 0);
  return { ...summary, remaining, counts: remainingScan.counts, errors: summary.errors.slice(0, 20) };
};

export const cleanupMigratedCloudinary = async (tenantId: string, force = false) => {
  const tid = new Types.ObjectId(tenantId);
  const now = new Date();
  const filter: any = { tenantId: tid, status: 'migrated' };
  if (!force) filter.cleanupEligibleAt = { $lte: now };

  const backups = await MediaMigrationBackup.find(filter).limit(500);
  if (!backups.length) return { requested: 0, deleted: 0, failed: 0 };

  const publicIds = Array.from(new Set(backups.map((b) => b.oldPublicId).filter(Boolean)));
  const cloudinary = getProvider('cloudinary');
  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < publicIds.length; i += 50) {
    const batch = publicIds.slice(i, i + 50);
    const res = await cloudinary.delete(batch);
    if (res.deleted.length) {
      deleted += res.deleted.length;
      await MediaMigrationBackup.updateMany(
        { tenantId: tid, oldPublicId: { $in: res.deleted }, status: 'migrated' },
        { $set: { status: 'cleaned', cleanedAt: now } },
      );
      await MediaAsset.updateMany(
        { tenantId: tid, provider: 'cloudinary', key: { $in: res.deleted } },
        { $set: { status: 'deleted', deletedAt: now } },
      );
    }
    if (res.failed.length) {
      failed += res.failed.length;
      for (const f of res.failed) {
        await MediaMigrationBackup.updateMany(
          { tenantId: tid, oldPublicId: f.id, status: 'migrated' },
          { $set: { status: 'cleanup_failed', error: f.error } },
        );
      }
    }
  }

  // Backup rows without a resolvable oldPublicId are marked cleaned so they don't stay stuck
  await MediaMigrationBackup.updateMany(
    { tenantId: tid, status: 'migrated', oldPublicId: '' },
    { $set: { status: 'cleaned', cleanedAt: now } },
  );

  return { requested: publicIds.length, deleted, failed };
};

export const getMigrationHistory = async (tenantId: string) =>
  MediaMigrationBackup.find({ tenantId: new Types.ObjectId(tenantId) })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
