import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import CustomError from '../../helpers/CustomError';
import { getClientIp } from '../../utils/ipHelper';
import config from '../../config';
import { GlobalSetting } from '../system/globalSetting.model';
import { Package } from '../package/package.model';
import { Tenant } from '../tenant/tenant.model';
import { ResourceAuditLog, ResourceIngestCheckpoint } from './resource.model';
import {
  getResourceSettings,
  invalidateResourceSettingsCache,
  mergeAndValidateSettings,
} from './resource.settings';
import { getMerchantOverview, reconcileStorage } from './resource.usage.service';
import { ResourceAddonService, audit } from './resource.addon.service';
import { getAdminAnalytics, listAdminPurchases, listAllMerchantsUsage } from './resource.analytics.service';
import { ingestWindow, runCloudflareIngestCycle } from './resource.ingest.service';
import { isValidPeriod, periodKey } from './resource.logic';

const tenantOf = (req: Request): string => {
  const t = req.user?.tenantId;
  if (!t) throw new CustomError(400, 'Tenant context is required');
  return String(t);
};
const idParam = (req: Request, name = 'id'): string => {
  const v = String(req.params[name] || '');
  if (!Types.ObjectId.isValid(v)) throw new CustomError(400, `Invalid ${name}`);
  return v;
};
const period = (raw: unknown): string => (isValidPeriod(raw) ? raw : periodKey());

/* ───────────── merchant ───────────── */
const myOverview = asyncHandler(async (req, res) => {
  ApiResponse.sendSuccess(res, 200, 'Resource usage retrieved', await getMerchantOverview(tenantOf(req), period(req.query.period)));
});
const listAddons = asyncHandler(async (req, res) => {
  ApiResponse.sendSuccess(res, 200, 'Add-ons retrieved', await ResourceAddonService.listAvailable(tenantOf(req)));
});
const purchaseAddon = asyncHandler(async (req, res) => {
  ApiResponse.sendSuccess(res, 201, 'Purchase submitted. Your resources will be activated after payment verification.', await ResourceAddonService.purchase(tenantOf(req), req.body));
});
const myPurchases = asyncHandler(async (req, res) => {
  ApiResponse.sendSuccess(res, 200, 'Purchases retrieved', await ResourceAddonService.listMyPurchases(tenantOf(req)));
});

/* ───────────── admin: settings ───────────── */
const getSettings = asyncHandler(async (_req, res) => {
  invalidateResourceSettingsCache();
  ApiResponse.sendSuccess(res, 200, 'Resource settings retrieved', await getResourceSettings());
});
const updateSettings = asyncHandler(async (req, res) => {
  const current = await getResourceSettings();
  const result = mergeAndValidateSettings(current, req.body || {});
  if (!result.ok) throw new CustomError(400, result.errors.join('; '));
  let doc: any = await GlobalSetting.findOne();
  if (!doc) doc = new GlobalSetting();
  doc.resource = result.value;
  doc.markModified('resource');
  await doc.save();
  invalidateResourceSettingsCache();
  await audit(req.user?._id, 'SETTINGS_UPDATED', 'ResourceSettings', String(doc._id), current, result.value, getClientIp(req));
  ApiResponse.sendSuccess(res, 200, 'Resource settings updated', result.value);
});

/* ───────────── admin: packages ───────────── */
const pkgResourcesSchema = z.object({
  storageBytes: z.number().int().min(0).nullable().optional(),
  imageBandwidthBytes: z.number().int().min(0).nullable().optional(),
  generalBandwidthBytes: z.number().int().min(0).nullable().optional(),
  combinedBandwidthBytes: z.number().int().min(0).nullable().optional(),
  trackingEnabled: z.boolean().optional(),
  overLimitPolicy: z
    .enum(['warn_only', 'block_uploads', 'block_uploads_keep_existing', 'show_prompt', 'apply_restrictions'])
    .nullable()
    .optional(),
});
const listPackageResources = asyncHandler(async (_req, res) => {
  const pkgs = await Package.find().select('name billingCycle price isActive resources').sort({ price: 1 }).lean();
  ApiResponse.sendSuccess(res, 200, 'Package resources retrieved', pkgs);
});
const updatePackageResources = asyncHandler(async (req, res) => {
  const id = idParam(req);
  const parsed = pkgResourcesSchema.safeParse(req.body);
  if (!parsed.success) throw new CustomError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const before: any = await Package.findById(id).select('resources').lean();
  if (!before) throw new CustomError(404, 'Package not found');
  const merged = { ...(before.resources || {}), ...parsed.data };
  const updated = await Package.findByIdAndUpdate(id, { $set: { resources: merged } }, { returnDocument: 'after' }).select('name resources');
  await audit(req.user?._id, 'PACKAGE_RESOURCES_UPDATED', 'Package', id, before.resources, merged, getClientIp(req));
  ApiResponse.sendSuccess(res, 200, 'Package resources updated', updated);
});

/* ───────────── admin: add-ons ───────────── */
const adminListAddons = asyncHandler(async (_req, res) => {
  ApiResponse.sendSuccess(res, 200, 'Add-ons retrieved', await ResourceAddonService.listAddonsAdmin());
});
const adminCreateAddon = asyncHandler(async (req, res) => {
  ApiResponse.sendSuccess(res, 201, 'Add-on created', await ResourceAddonService.createAddon(req.body, req.user, getClientIp(req)));
});
const adminUpdateAddon = asyncHandler(async (req, res) => {
  ApiResponse.sendSuccess(res, 200, 'Add-on updated', await ResourceAddonService.updateAddon(idParam(req), req.body, req.user, getClientIp(req)));
});
const adminToggleAddon = asyncHandler(async (req, res) => {
  const isActive = Boolean(req.body?.isActive);
  ApiResponse.sendSuccess(res, 200, 'Add-on status updated', await ResourceAddonService.setAddonActive(idParam(req), isActive, req.user, getClientIp(req)));
});
const adminDeleteAddon = asyncHandler(async (req, res) => {
  ApiResponse.sendSuccess(res, 200, 'Add-on removed', await ResourceAddonService.deleteAddon(idParam(req), req.user, getClientIp(req)));
});
const adminPurchases = asyncHandler(async (req, res) => {
  const { data, meta } = await listAdminPurchases(req.query as any);
  ApiResponse.sendSuccess(res, 200, 'Purchases retrieved', data, meta);
});
const adminRefund = asyncHandler(async (req, res) => {
  ApiResponse.sendSuccess(res, 200, 'Purchase refunded', await ResourceAddonService.refundPurchase(idParam(req), req.user, req.body?.reason, getClientIp(req)));
});

/* ───────────── admin: analytics / ops ───────────── */
const adminAnalytics = asyncHandler(async (req, res) => {
  const q: any = req.query;
  ApiResponse.sendSuccess(res, 200, 'Resource analytics retrieved', await getAdminAnalytics({
    period: isValidPeriod(q.period) ? q.period : undefined, tenantId: q.tenantId, packageId: q.packageId, addonCategory: q.addonCategory,
  }));
});
const adminMerchantsUsage = asyncHandler(async (req, res) => {
  const q: any = req.query;
  const { data, meta } = await listAllMerchantsUsage({
    period: isValidPeriod(q.period) ? q.period : undefined,
    search: typeof q.search === 'string' ? q.search : undefined,
    page: q.page ? Number(q.page) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  ApiResponse.sendSuccess(res, 200, 'Merchants resource usage retrieved', data, meta);
});
const adminTenantOverview = asyncHandler(async (req, res) => {
  const tid = idParam(req, 'tenantId');
  if (!(await Tenant.exists({ _id: tid }))) throw new CustomError(404, 'Tenant not found');
  ApiResponse.sendSuccess(res, 200, 'Tenant resource usage retrieved', await getMerchantOverview(tid, period(req.query.period)));
});
const adminReconcile = asyncHandler(async (req, res) => {
  const tid = idParam(req, 'tenantId');
  const result = await reconcileStorage(tid);
  await audit(req.user?._id, 'STORAGE_RECONCILED', 'Tenant', tid, null, result, getClientIp(req));
  ApiResponse.sendSuccess(res, 200, 'Storage reconciled from asset inventory', result);
});
const adminAuditLogs = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  ApiResponse.sendSuccess(res, 200, 'Audit logs retrieved', await ResourceAuditLog.find().sort({ createdAt: -1 }).limit(limit).lean());
});
const adminIngestStatus = asyncHandler(async (_req, res) => {
  const [last, recentFailures, settings] = await Promise.all([
    ResourceIngestCheckpoint.findOne({ source: 'cloudflare', status: 'done' }).sort({ windowEnd: -1 }).lean(),
    ResourceIngestCheckpoint.find({ status: 'failed' }).sort({ updatedAt: -1 }).limit(10).lean(),
    getResourceSettings(),
  ]);
  ApiResponse.sendSuccess(res, 200, 'Ingest status', {
    cloudflareSyncEnabled: settings.analytics.cloudflareSyncEnabled,
    credentialsConfigured: !!(config.cloudflare.zoneId && config.cloudflare.apiToken),
    lastCompletedWindowEnd: (last as any)?.windowEnd || null,
    recentFailures,
  });
});
const adminRunIngest = asyncHandler(async (_req, res) => {
  ApiResponse.sendSuccess(res, 200, 'Ingest cycle finished', await runCloudflareIngestCycle());
});

/** SIMULATED events for local testing. Disabled in production and unless explicitly enabled. */
const mockSchema = z.object({
  batchId: z.string().min(3).max(80),
  windowStart: z.string().datetime(),
  rows: z.array(z.object({
    tenantId: z.string().optional(),
    host: z.string().optional(),
    path: z.string().optional(),
    contentType: z.string().optional(),
    cacheStatus: z.string().optional(),
    bytes: z.number().int().min(0),
    requests: z.number().int().min(0),
  })).max(5000),
});
const adminMockEvents = asyncHandler(async (req, res) => {
  if (config.app.env === 'production' || process.env.RESOURCE_DEV_ENDPOINTS !== 'true') {
    throw new CustomError(404, 'Not found');
  }
  const parsed = mockSchema.safeParse(req.body);
  if (!parsed.success) throw new CustomError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const start = new Date(parsed.data.windowStart);
  const settings = await getResourceSettings();
  const end = new Date(start.getTime() + settings.aggregationIntervalMin * 60_000);
  const rows = parsed.data.rows.map((r) => ({
    tenantId: r.tenantId, host: r.host, path: r.path, contentType: r.contentType, cacheStatus: r.cacheStatus, bytes: r.bytes, requests: r.requests,
  }));
  const result = await ingestWindow({ source: `mock:${parsed.data.batchId}`, windowStart: start, windowEnd: end, rows });
  ApiResponse.sendSuccess(res, 200, 'SIMULATED events ingested', result);
});

export const ResourceController = {
  myOverview, listAddons, purchaseAddon, myPurchases,
  getSettings, updateSettings, listPackageResources, updatePackageResources,
  adminListAddons, adminCreateAddon, adminUpdateAddon, adminToggleAddon, adminDeleteAddon,
  adminPurchases, adminRefund, adminAnalytics, adminMerchantsUsage, adminTenantOverview, adminReconcile,
  adminAuditLogs, adminIngestStatus, adminRunIngest, adminMockEvents,
};
void (null as unknown as Response);
