import { Types } from 'mongoose';
import { MerchantResourceUsage, MerchantStorageState, ResourceAddonPurchase } from './resource.model';
import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';
import { periodKey, percentUsed } from './resource.logic';

const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Tenant ids restricted by package filter (active subscription). Returns null = no restriction. */
const tenantsForPackage = async (packageId?: string): Promise<Types.ObjectId[] | null> => {
  if (!packageId || !Types.ObjectId.isValid(packageId)) return null;
  const subs: any[] = await Subscription.find({ packageId, status: 'active' }).select('tenantId').lean();
  return subs.map((s) => new Types.ObjectId(String(s.tenantId)));
};

export const getAdminAnalytics = async (q: {
  period?: string; tenantId?: string; packageId?: string; addonCategory?: string;
}) => {
  const period = q.period || periodKey();
  const pkgTenants = await tenantsForPackage(q.packageId);
  const tenantFilter: any = {};
  if (q.tenantId && Types.ObjectId.isValid(q.tenantId)) tenantFilter.tenantId = new Types.ObjectId(q.tenantId);
  if (pkgTenants) {
    tenantFilter.tenantId = tenantFilter.tenantId
      ? (pkgTenants.some((t) => t.equals(tenantFilter.tenantId)) ? tenantFilter.tenantId : { $in: [] })
      : { $in: pkgTenants };
  }

  const [usageAgg, storageAgg, top, daily, trend] = await Promise.all([
    MerchantResourceUsage.aggregate([
      { $match: { period, ...tenantFilter } },
      { $group: {
          _id: null,
          imageBytes: { $sum: '$image.bytes' }, imageRequests: { $sum: '$image.requests' },
          cacheHit: { $sum: '$image.cacheHit' }, cacheMiss: { $sum: '$image.cacheMiss' },
          generalBytes: { $sum: '$general.bytes' }, generalRequests: { $sum: '$general.requests' },
          merchants: { $sum: 1 },
      } },
    ]),
    MerchantStorageState.aggregate([
      { $match: tenantFilter },
      { $group: { _id: null, bytes: { $sum: '$usedBytes' }, files: { $sum: '$fileCount' }, merchants: { $sum: 1 } } },
    ]),
    MerchantResourceUsage.aggregate([
      { $match: { period, ...tenantFilter } },
      { $addFields: { total: { $add: ['$image.bytes', '$general.bytes'] } } },
      { $sort: { total: -1 } },
      { $limit: 10 },
      { $project: { tenantId: 1, imageBytes: '$image.bytes', generalBytes: '$general.bytes', total: 1, limits: 1 } },
    ]),
    MerchantResourceUsage.aggregate([
      { $match: { period, ...tenantFilter } },
      { $project: { d: { $objectToArray: '$daily' } } },
      { $unwind: '$d' },
      { $group: {
          _id: '$d.k',
          imageBytes: { $sum: '$d.v.imageBytes' }, generalBytes: { $sum: '$d.v.generalBytes' },
          imageRequests: { $sum: '$d.v.imageRequests' }, generalRequests: { $sum: '$d.v.generalRequests' },
      } },
      { $sort: { _id: 1 } },
    ]),
    MerchantResourceUsage.aggregate([
      { $match: tenantFilter },
      { $group: { _id: '$period', imageBytes: { $sum: '$image.bytes' }, generalBytes: { $sum: '$general.bytes' } } },
      { $sort: { _id: -1 } },
      { $limit: 12 },
    ]),
  ]);

  // near / over limit — from the limit snapshot stored with each usage doc (no per-merchant recompute)
  const withLimits: any[] = await MerchantResourceUsage.find({ period, ...tenantFilter })
    .select('tenantId image general limits').lean();
  const storageStates: any[] = await MerchantStorageState.find({ ...tenantFilter, limitBytes: { $gt: 0 } })
    .select('tenantId usedBytes limitBytes').lean();
  const risk: { tenantId: string; resource: string; percent: number }[] = [];
  for (const u of withLimits) {
    const rows = [
      ['image_bandwidth', num(u.image?.bytes), num(u.limits?.imageBytes)],
      ['general_bandwidth', num(u.general?.bytes), num(u.limits?.generalBytes)],
      ['combined_bandwidth', num(u.image?.bytes) + num(u.general?.bytes), num(u.limits?.combinedBytes)],
    ] as const;
    for (const [res, used, lim] of rows) if (lim > 0) risk.push({ tenantId: String(u.tenantId), resource: res, percent: percentUsed(used, lim) });
  }
  for (const s of storageStates) risk.push({ tenantId: String(s.tenantId), resource: 'storage', percent: percentUsed(s.usedBytes, s.limitBytes) });
  const approaching = risk.filter((r) => r.percent >= 85 && r.percent < 100).sort((a, b) => b.percent - a.percent).slice(0, 50);
  const exceeding = risk.filter((r) => r.percent >= 100).sort((a, b) => b.percent - a.percent).slice(0, 50);

  const names = new Map<string, string>();
  const ids = Array.from(new Set([...top.map((t) => String(t.tenantId)), ...approaching.map((r) => r.tenantId), ...exceeding.map((r) => r.tenantId)]));
  if (ids.length) {
    const tenants: any[] = await Tenant.find({ _id: { $in: ids } }).select('name slug').lean();
    tenants.forEach((t) => names.set(String(t._id), t.name || t.slug));
  }
  const label = (id: string) => ({ tenantId: id, name: names.get(id) || id });

  const purchaseMatch: any = { status: { $in: ['active', 'expired'] } };
  if (q.addonCategory) purchaseMatch.category = q.addonCategory;
  if (q.tenantId && Types.ObjectId.isValid(q.tenantId)) purchaseMatch.tenantId = new Types.ObjectId(q.tenantId);
  const sales = await ResourceAddonPurchase.aggregate([
    { $match: purchaseMatch },
    { $group: { _id: '$category', count: { $sum: 1 }, revenue: { $sum: '$totalPrice' } } },
  ]);

  const u = usageAgg[0] || {};
  const st = storageAgg[0] || {};
  return {
    period,
    totals: {
      storageBytes: num(st.bytes), storageFiles: num(st.files),
      imageBytes: num(u.imageBytes), generalBytes: num(u.generalBytes),
      combinedBytes: num(u.imageBytes) + num(u.generalBytes),
      imageRequests: num(u.imageRequests), generalRequests: num(u.generalRequests),
      cacheHit: num(u.cacheHit), cacheMiss: num(u.cacheMiss),
      merchantsWithUsage: num(u.merchants),
    },
    topMerchants: top.map((t) => ({ ...label(String(t.tenantId)), imageBytes: t.imageBytes, generalBytes: t.generalBytes, totalBytes: t.total })),
    approachingLimit: approaching.map((r) => ({ ...label(r.tenantId), resource: r.resource, percent: r.percent })),
    exceedingLimit: exceeding.map((r) => ({ ...label(r.tenantId), resource: r.resource, percent: r.percent })),
    addonSales: sales.map((s) => ({ category: s._id, purchases: s.count, revenue: s.revenue })),
    dailyTrend: daily.map((d) => ({ day: d._id, imageBytes: num(d.imageBytes), generalBytes: num(d.generalBytes), imageRequests: num(d.imageRequests), generalRequests: num(d.generalRequests) })),
    monthlyTrend: trend.reverse().map((t) => ({ period: t._id, imageBytes: num(t.imageBytes), generalBytes: num(t.generalBytes) })),
    note: 'Near/over-limit uses the limit snapshot stored at the last usage update. Bandwidth data is delayed (batch ingested).',
  };
};

export const listAdminPurchases = async (q: { status?: string; tenantId?: string; category?: string; page?: number; limit?: number }) => {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  const filter: any = {};
  if (q.status) filter.status = q.status;
  if (q.category) filter.category = q.category;
  if (q.tenantId && Types.ObjectId.isValid(q.tenantId)) filter.tenantId = q.tenantId;
  const [data, total] = await Promise.all([
    ResourceAddonPurchase.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('tenantId', 'name slug').lean(),
    ResourceAddonPurchase.countDocuments(filter),
  ]);
  return { data, meta: { page, limit, total } };
};

export const listAllMerchantsUsage = async (q: {
  period?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}) => {
  const period = q.period || periodKey();
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  const filter: any = {};
  if (q.search && q.search.trim()) {
    const rx = new RegExp(q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { slug: rx }, { customDomain: rx }];
  }

  const [tenants, total] = await Promise.all([
    Tenant.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('name slug customDomain status')
      .lean<any[]>(),
    Tenant.countDocuments(filter),
  ]);

  const ids = tenants.map((t) => t._id);
  const [storages, usages, subs] = ids.length
    ? await Promise.all([
        MerchantStorageState.find({ tenantId: { $in: ids } }).lean<any[]>(),
        MerchantResourceUsage.find({ tenantId: { $in: ids }, period }).lean<any[]>(),
        Subscription.find({ tenantId: { $in: ids }, status: 'active' })
          .populate('packageId', 'name')
          .select('tenantId packageId')
          .lean<any[]>(),
      ])
    : [[], [], []];

  const stMap = new Map(storages.map((s) => [String(s.tenantId), s]));
  const usMap = new Map(usages.map((u) => [String(u.tenantId), u]));
  const subMap = new Map(subs.map((s) => [String(s.tenantId), s]));

  const data = tenants.map((t) => {
    const id = String(t._id);
    const st = stMap.get(id);
    const us = usMap.get(id);
    const sub = subMap.get(id);
    const imageBytes = num(us?.image?.bytes);
    const generalBytes = num(us?.general?.bytes);
    return {
      tenantId: id,
      name: t.name,
      slug: t.slug,
      customDomain: t.customDomain || null,
      status: t.status,
      packageName: sub?.packageId?.name || 'Default',
      storageBytes: num(st?.usedBytes),
      storageLimitBytes: num(st?.limitBytes),
      fileCount: num(st?.fileCount),
      imageBytes,
      imageRequests: num(us?.image?.requests),
      generalBytes,
      generalRequests: num(us?.general?.requests),
      combinedBytes: imageBytes + generalBytes,
    };
  });

  return { data, meta: { page, limit, total } };
};
