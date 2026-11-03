import { Types } from 'mongoose';
import { Tenant } from '../tenant/tenant.model';
import { Product } from '../product/product.model';
import {
  AnalyticsEvent,
  ProductDailyAnalytics,
  StoreDailyAnalytics,
} from './analytics.model';
import { StoreVisit } from './storeVisit.model';
import {
  ITrackBatchPayload,
  AnalyticsEventType,
} from './analytics.interface';
import CustomError from '../../helpers/CustomError';
import { paginationHelper } from '../../helpers/paginationHelper';

// ─────────────────────────────────────────────────────────────────────────────
// Date Range Helper
// ─────────────────────────────────────────────────────────────────────────────
export const getDateRange = (
  period?: string,
  customStart?: string,
  customEnd?: string
): {
  startDate: Date;
  endDate: Date;
  startStr: string;
  endStr: string;
  prevStartDate: Date;
  prevEndDate: Date;
} => {
  const now = new Date();
  let startDate = new Date();
  let endDate = new Date(now);

  const normalized = (period || '30d').toLowerCase().trim();

  if (normalized === 'today') {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
  } else if (normalized === 'yesterday') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);
  } else if (normalized === '7d' || normalized === 'last_7_days' || normalized === '7days') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
  } else if (normalized === 'this_month' || normalized === 'thismonth' || normalized === 'monthly') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  } else if (normalized === 'last_month' || normalized === 'lastmonth') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  } else if (normalized === 'yearly' || normalized === 'this_year' || normalized === 'year') {
    startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  } else if (normalized === 'last_365_days' || normalized === '365days' || normalized === '365d') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 364);
    startDate.setHours(0, 0, 0, 0);
  } else if (normalized === 'custom' && customStart && customEnd) {
    startDate = new Date(customStart);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(customEnd);
    endDate.setHours(23, 59, 59, 999);
  } else {
    // Default 30 days
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 29);
    startDate.setHours(0, 0, 0, 0);
  }

  const durationMs = Math.max(endDate.getTime() - startDate.getTime(), 24 * 60 * 60 * 1000);
  const prevEndDate = new Date(startDate.getTime() - 1);
  const prevStartDate = new Date(prevEndDate.getTime() - durationMs);

  const toYMD = (d: Date): string => (d.toISOString().split('T')[0] || '');

  return {
    startDate,
    endDate,
    startStr: toYMD(startDate) || '',
    endStr: toYMD(endDate) || '',
    prevStartDate,
    prevEndDate,
  };
};

const formatDateYMD = (d: Date): string => d.toISOString().split('T')[0] || '';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Ingest Batched Events (Public Storefront API)
// ─────────────────────────────────────────────────────────────────────────────
const trackEvents = async (
  payload: ITrackBatchPayload,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<{ processed: number; success: boolean }> => {
  const { tenantId: rawTenantId, tenantSlug, sessionId, visitorId, events } = payload;

  if (!Array.isArray(events) || events.length === 0) {
    return { processed: 0, success: true };
  }

  // Filter out bots and crawlers
  const ua = (meta.userAgent || '').toLowerCase();
  if (/bot|crawler|spider|googlebot|bingbot|yandex|baiduspider|duckduckbot/i.test(ua)) {
    return { processed: 0, success: true };
  }

  // Resolve tenant
  let tenant: any = null;
  if (rawTenantId && Types.ObjectId.isValid(rawTenantId)) {
    tenant = await Tenant.findById(rawTenantId).select('_id status').lean();
  } else if (tenantSlug) {
    tenant = await Tenant.findOne({
      $or: [{ slug: tenantSlug }, { domain: tenantSlug }, { customDomain: tenantSlug }],
    })
      .select('_id status')
      .lean();
  }

  if (!tenant || tenant.status === 'banned') {
    throw new CustomError(404, 'Storefront tenant not found or inactive');
  }

  const tenantObjectId = new Types.ObjectId(tenant._id);
  const cleanSessionId = (sessionId || 'unknown_session').slice(0, 128);
  const cleanVisitorId = visitorId ? String(visitorId).slice(0, 128) : null;

  // Cache valid product IDs for this tenant in this batch to avoid spoofing
  const incomingProductIds = Array.from(
    new Set(
      events
        .map((e) => e.productId)
        .filter((id): id is string => Boolean(id && Types.ObjectId.isValid(id)))
    )
  );

  let validProductMap = new Set<string>();
  if (incomingProductIds.length > 0) {
    const validProducts = await Product.find({
      _id: { $in: incomingProductIds.map((id) => new Types.ObjectId(id)) },
      tenantId: tenantObjectId,
    })
      .select('_id')
      .lean();
    validProductMap = new Set(validProducts.map((p) => p._id.toString()));
  }

  const eventDocs: any[] = [];
  const productDeltas: Record<string, { impressions: number; clicks: number }> = {};
  const productDailyDeltas: Record<string, { impressions: number; clicks: number }> = {};
  const storeDailyDeltas: Record<string, { impressions: number; clicks: number; visits: number }> = {};

  const now = new Date();
  const defaultDateStr = formatDateYMD(now);

  for (const item of events.slice(0, 100)) { // limit to max 100 events per batch
    const eventType: AnalyticsEventType = item.eventType;
    if (!['product_impression', 'product_click', 'store_visit'].includes(eventType)) {
      continue;
    }

    const eventDate = item.timestamp ? new Date(item.timestamp) : now;
    const eventDateStr = formatDateYMD(isNaN(eventDate.getTime()) ? now : eventDate);

    let productObjectId: Types.ObjectId | null = null;
    if (item.productId && validProductMap.has(String(item.productId))) {
      productObjectId = new Types.ObjectId(item.productId);
    }

    // Ignore product-specific events if product ID is not valid for this tenant
    if (['product_impression', 'product_click'].includes(eventType) && !productObjectId) {
      continue;
    }

    eventDocs.push({
      eventType,
      tenantId: tenantObjectId,
      productId: productObjectId,
      sessionId: cleanSessionId,
      visitorId: cleanVisitorId,
      sourcePage: (item.sourcePage || '/').slice(0, 255),
      sourceSection: (item.sourceSection || 'general').slice(0, 100),
      timestamp: isNaN(eventDate.getTime()) ? now : eventDate,
      dateStr: eventDateStr,
      ipAddress: meta.ipAddress || '',
      userAgent: (meta.userAgent || '').slice(0, 500),
    });

    // Aggregate deltas for atomic batch updates
    if (productObjectId) {
      const pidStr = productObjectId.toString();
      if (!productDeltas[pidStr]) {
        productDeltas[pidStr] = { impressions: 0, clicks: 0 };
      }
      const pDailyKey = `${pidStr}_${eventDateStr}`;
      if (!productDailyDeltas[pDailyKey]) {
        productDailyDeltas[pDailyKey] = { impressions: 0, clicks: 0 };
      }

      if (eventType === 'product_impression') {
        productDeltas[pidStr].impressions += 1;
        productDailyDeltas[pDailyKey].impressions += 1;
      } else if (eventType === 'product_click') {
        productDeltas[pidStr].clicks += 1;
        productDailyDeltas[pDailyKey].clicks += 1;
      }
    }

    if (!storeDailyDeltas[eventDateStr]) {
      storeDailyDeltas[eventDateStr] = { impressions: 0, clicks: 0, visits: 0 };
    }
    if (eventType === 'product_impression') {
      storeDailyDeltas[eventDateStr].impressions += 1;
    } else if (eventType === 'product_click') {
      storeDailyDeltas[eventDateStr].clicks += 1;
    } else if (eventType === 'store_visit') {
      storeDailyDeltas[eventDateStr].visits += 1;
    }
  }

  // 1. Insert granular events
  if (eventDocs.length > 0) {
    await AnalyticsEvent.insertMany(eventDocs, { ordered: false }).catch(() => {});
  }

  // 2. Increment lifetime counters on Product models (enables instant sorting in products table)
  const productBulkOps = Object.entries(productDeltas).map(([pid, delta]) => ({
    updateOne: {
      filter: { _id: new Types.ObjectId(pid), tenantId: tenantObjectId },
      update: {
        $inc: {
          impressionsCount: delta.impressions,
          clicksCount: delta.clicks,
        },
      },
    },
  }));
  if (productBulkOps.length > 0) {
    await Product.bulkWrite(productBulkOps, { ordered: false }).catch(() => {});
  }

  // 3. Upsert daily product analytics
  const productDailyBulkOps = Object.entries(productDailyDeltas).map(([key, delta]) => {
    const parts = key.split('_');
    const pid = parts[0] || '';
    const dStr = parts[1] || defaultDateStr;
    return {
      updateOne: {
        filter: {
          tenantId: tenantObjectId,
          productId: new Types.ObjectId(pid),
          dateStr: dStr,
        },
        update: {
          $inc: {
            impressions: delta.impressions,
            clicks: delta.clicks,
          },
        },
        upsert: true,
      },
    };
  });
  if (productDailyBulkOps.length > 0) {
    await ProductDailyAnalytics.bulkWrite(productDailyBulkOps, { ordered: false }).catch(() => {});
  }

  // 4. Upsert daily store analytics
  const storeDailyBulkOps = Object.entries(storeDailyDeltas).map(([dStr, delta]) => {
    const updateObj: any = {
      $inc: {
        impressions: delta.impressions,
        clicks: delta.clicks,
        visits: delta.visits,
      },
    };
    if (cleanVisitorId) {
      updateObj.$addToSet = { uniqueVisitors: cleanVisitorId };
    }
    return {
      updateOne: {
        filter: {
          tenantId: tenantObjectId,
          dateStr: dStr,
        },
        update: updateObj,
        upsert: true,
      },
    };
  });
  if (storeDailyBulkOps.length > 0) {
    await StoreDailyAnalytics.bulkWrite(storeDailyBulkOps, { ordered: false }).catch(() => {});
  }

  // 5. If store_visit event present, also write to legacy StoreVisit model for backward compatibility
  const visitEvents = eventDocs.filter((e) => e.eventType === 'store_visit');
  if (visitEvents.length > 0) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const existingVisit = await StoreVisit.findOne({
      tenantId: tenantObjectId,
      sessionId: cleanSessionId,
      createdAt: { $gte: startOfToday },
    });
    if (!existingVisit) {
      await StoreVisit.create({
        tenantId: tenantObjectId,
        sessionId: cleanSessionId,
      }).catch(() => {});
    }
  }

  return { processed: eventDocs.length, success: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Merchant Dashboard: Overview Analytics
// ─────────────────────────────────────────────────────────────────────────────
const getMerchantOverview = async (tenantId: string, query: any) => {
  const tenantObjectId = new Types.ObjectId(tenantId);
  const periodParam = query.period || query.range;
  const { startDate, endDate, startStr, endStr, prevStartDate, prevEndDate } = getDateRange(
    periodParam,
    query.startDate,
    query.endDate
  );

  const prevStartStr = formatDateYMD(prevStartDate);
  const prevEndStr = formatDateYMD(prevEndDate);

  // 1. Current period aggregated from StoreDailyAnalytics
  const currentDailyStats = await StoreDailyAnalytics.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        dateStr: { $gte: startStr, $lte: endStr },
      },
    },
    {
      $group: {
        _id: null,
        totalVisits: { $sum: '$visits' },
        totalImpressions: { $sum: '$impressions' },
        totalClicks: { $sum: '$clicks' },
      },
    },
  ]);

  // Fallback to legacy StoreVisit count if storeDailyAnalytics visits is 0
  const legacyVisitsCount = await StoreVisit.countDocuments({
    tenantId: tenantObjectId,
    createdAt: { $gte: startDate, $lte: endDate },
  });

  const rawVisits = currentDailyStats[0]?.totalVisits || 0;
  const totalStoreVisits = Math.max(rawVisits, legacyVisitsCount);
  const totalProductImpressions = currentDailyStats[0]?.totalImpressions || 0;
  const totalProductClicks = currentDailyStats[0]?.totalClicks || 0;

  // Unique Visitors: count distinct visitorId or sessionId from AnalyticsEvent or StoreVisit
  const uniqueVisitorsResult = await AnalyticsEvent.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: { $ifNull: ['$visitorId', '$sessionId'] },
      },
    },
    {
      $count: 'count',
    },
  ]);
  const totalUniqueVisitors = uniqueVisitorsResult[0]?.count || (totalStoreVisits > 0 ? totalStoreVisits : 0);

  // Total Products Count
  const totalProducts = await Product.countDocuments({ tenantId: tenantObjectId });

  // CTR Calculation
  const ctr =
    totalProductImpressions > 0
      ? parseFloat(((totalProductClicks / totalProductImpressions) * 100).toFixed(2))
      : 0;

  // 2. Previous period for comparison trends
  const prevDailyStats = await StoreDailyAnalytics.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        dateStr: { $gte: prevStartStr, $lte: prevEndStr },
      },
    },
    {
      $group: {
        _id: null,
        totalVisits: { $sum: '$visits' },
        totalImpressions: { $sum: '$impressions' },
        totalClicks: { $sum: '$clicks' },
      },
    },
  ]);

  const prevStoreVisits = prevDailyStats[0]?.totalVisits || 0;
  const prevProductImpressions = prevDailyStats[0]?.totalImpressions || 0;
  const prevProductClicks = prevDailyStats[0]?.totalClicks || 0;
  const prevCtr =
    prevProductImpressions > 0
      ? parseFloat(((prevProductClicks / prevProductImpressions) * 100).toFixed(2))
      : 0;

  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return parseFloat((((current - previous) / previous) * 100).toFixed(1));
  };

  const overview = {
    totalStoreVisits,
    totalProductImpressions,
    totalProductClicks,
    totalUniqueVisitors,
    totalProducts,
    ctr,
    totalVisits: totalStoreVisits,
    totalImpressions: totalProductImpressions,
    totalClicks: totalProductClicks,
    uniqueVisitors: totalUniqueVisitors,
  };

  return {
    period: periodParam || '30d',
    dateRange: { startDate, endDate, startStr, endStr },
    overview,
    ...overview,
    trends: {
      visitsChange: calculateChange(totalStoreVisits, prevStoreVisits),
      impressionsChange: calculateChange(totalProductImpressions, prevProductImpressions),
      clicksChange: calculateChange(totalProductClicks, prevProductClicks),
      ctrChange: parseFloat((ctr - prevCtr).toFixed(2)),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Merchant Dashboard: Timeline (Impressions, Clicks, Visits over Time)
// ─────────────────────────────────────────────────────────────────────────────
const getMerchantTimeline = async (tenantId: string, query: any) => {
  const tenantObjectId = new Types.ObjectId(tenantId);
  const periodParam = query.period || query.range;
  const { startDate, endDate, startStr, endStr } = getDateRange(
    periodParam,
    query.startDate,
    query.endDate
  );

  const dailyDocs = await StoreDailyAnalytics.find({
    tenantId: tenantObjectId,
    dateStr: { $gte: startStr, $lte: endStr },
  })
    .sort({ dateStr: 1 })
    .lean();

  const dataMap = new Map<string, { impressions: number; clicks: number; visits: number }>();
  dailyDocs.forEach((d) => {
    dataMap.set(d.dateStr, {
      impressions: d.impressions || 0,
      clicks: d.clicks || 0,
      visits: d.visits || 0,
    });
  });

  // Generate continuous day-by-day dates
  const timeline: Array<{
    date: string;
    formattedDate: string;
    impressions: number;
    clicks: number;
    visits: number;
    ctr: number;
  }> = [];

  const curr = new Date(startDate);
  while (curr <= endDate) {
    const dStr = formatDateYMD(curr);
    const item = dataMap.get(dStr) || { impressions: 0, clicks: 0, visits: 0 };
    const ctr =
      item.impressions > 0
        ? parseFloat(((item.clicks / item.impressions) * 100).toFixed(2))
        : 0;

    timeline.push({
      date: dStr,
      formattedDate: curr.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      impressions: item.impressions,
      clicks: item.clicks,
      visits: item.visits,
      ctr,
    });
    curr.setDate(curr.getDate() + 1);
  }

  return {
    period: query.period || '30d',
    timeline,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Merchant Dashboard: Top Products (Most-Impressed & Most-Clicked)
// ─────────────────────────────────────────────────────────────────────────────
const getMerchantTopProducts = async (tenantId: string, query: any) => {
  const tenantObjectId = new Types.ObjectId(tenantId);
  const periodParam = query.period || query.range;
  const { startStr, endStr } = getDateRange(periodParam, query.startDate, query.endDate);

  // Aggregate product impressions & clicks in date range
  const productAgg = await ProductDailyAnalytics.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        dateStr: { $gte: startStr, $lte: endStr },
      },
    },
    {
      $group: {
        _id: '$productId',
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
      },
    },
  ]);

  const productIds = productAgg.map((p) => p._id);
  const products = await Product.find({ _id: { $in: productIds } })
    .select('title slug images image discountedPrice price stock status')
    .lean();

  const productMap = new Map<string, any>();
  products.forEach((p) => {
    const imgUrl = p.images?.[0]?.secure_url || (p as any).image?.secure_url || (typeof (p as any).image === 'string' ? (p as any).image : '');
    productMap.set(p._id.toString(), {
      _id: p._id,
      title: p.title,
      slug: p.slug,
      image: imgUrl,
      price: p.discountedPrice ?? (p as any).price ?? 0,
      stock: p.stock ?? 0,
      status: p.status || 'ACTIVE',
    });
  });

  const enrichedList = productAgg
    .map((item) => {
      const p = productMap.get(item._id.toString());
      if (!p) return null;
      const ctr =
        item.impressions > 0
          ? parseFloat(((item.clicks / item.impressions) * 100).toFixed(2))
          : 0;
      return {
        ...p,
        impressions: item.impressions,
        clicks: item.clicks,
        ctr,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const topImpressed = [...enrichedList]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  const topClicked = [...enrichedList]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);

  return {
    topImpressed,
    topClicked,
    topByImpressions: topImpressed,
    topByClicks: topClicked,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Merchant Dashboard: Product-Wise Performance Table
// ─────────────────────────────────────────────────────────────────────────────
const getMerchantProducts = async (tenantId: string, query: any) => {
  const tenantObjectId = new Types.ObjectId(tenantId);
  const { page, limit, skip } = paginationHelper(query.page, query.limit);
  const { startStr, endStr } = getDateRange(query.period || query.range, query.startDate, query.endDate);
  const search = (query.search || '').trim();
  const sortBy = query.sortBy || 'impressions'; // 'impressions' | 'clicks' | 'ctr' | 'title' | 'price'
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

  // Filter for products
  const productFilter: any = { tenantId: tenantObjectId };
  if (search) {
    productFilter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
    ];
  }

  // Aggregate stats in the selected date range
  const dailyStats = await ProductDailyAnalytics.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        dateStr: { $gte: startStr, $lte: endStr },
      },
    },
    {
      $group: {
        _id: '$productId',
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
      },
    },
  ]);

  const statsMap = new Map<string, { impressions: number; clicks: number }>();
  dailyStats.forEach((s) => {
    statsMap.set(s._id.toString(), {
      impressions: s.impressions,
      clicks: s.clicks,
    });
  });

  // Fetch all matching products for this tenant
  const [allProducts, total] = await Promise.all([
    Product.find(productFilter)
      .populate('categoryId', 'name')
      .select('title slug images image discountedPrice price stock salesCount status categoryId createdAt impressionsCount clicksCount')
      .lean(),
    Product.countDocuments(productFilter),
  ]);

  const enrichedProducts = allProducts.map((p) => {
    const rangeStats = statsMap.get(p._id.toString());
    // If querying all-time / default and range is empty, use stored product counters as fallback
    const impressions = rangeStats ? rangeStats.impressions : (p.impressionsCount || 0);
    const clicks = rangeStats ? rangeStats.clicks : (p.clicksCount || 0);
    const ctr = impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(2)) : 0;
    const imgUrl = p.images?.[0]?.secure_url || (p as any).image?.secure_url || (typeof (p as any).image === 'string' ? (p as any).image : '');

    return {
      _id: p._id,
      title: p.title,
      slug: p.slug,
      image: imgUrl,
      categoryName: (p.categoryId as any)?.name || 'Uncategorized',
      price: p.discountedPrice ?? (p as any).price ?? 0,
      stock: p.stock ?? 0,
      salesCount: p.salesCount ?? 0,
      status: p.status || 'ACTIVE',
      impressions,
      clicks,
      ctr,
      createdAt: (p as any).createdAt,
    };
  });

  // In-memory sort by computed fields (impressions, clicks, ctr, etc.)
  enrichedProducts.sort((a, b) => {
    if (sortBy === 'clicks') return (a.clicks - b.clicks) * sortOrder;
    if (sortBy === 'ctr') return (a.ctr - b.ctr) * sortOrder;
    if (sortBy === 'price') return (a.price - b.price) * sortOrder;
    if (sortBy === 'title') return a.title.localeCompare(b.title) * sortOrder;
    return (a.impressions - b.impressions) * sortOrder;
  });

  const paginatedData = enrichedProducts.slice(skip, skip + limit);

  return {
    data: paginatedData,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. Super Admin Dashboard: Global Analytics Overview
// ─────────────────────────────────────────────────────────────────────────────
const getAdminOverview = async (query: any) => {
  const periodParam = query.period || query.range;
  const { startDate, endDate, startStr, endStr } = getDateRange(
    periodParam,
    query.startDate,
    query.endDate
  );

  const [totalsAgg, totalActiveMerchants, totalProducts] = await Promise.all([
    StoreDailyAnalytics.aggregate([
      {
        $match: {
          dateStr: { $gte: startStr, $lte: endStr },
        },
      },
      {
        $group: {
          _id: null,
          totalVisits: { $sum: '$visits' },
          totalImpressions: { $sum: '$impressions' },
          totalClicks: { $sum: '$clicks' },
        },
      },
    ]),
    Tenant.countDocuments({ status: 'active' }),
    Product.countDocuments({ status: 'ACTIVE' }),
  ]);

  const legacyVisitsCount = await StoreVisit.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
  });

  const totalStoreVisits = Math.max(totalsAgg[0]?.totalVisits || 0, legacyVisitsCount);
  const totalProductImpressions = totalsAgg[0]?.totalImpressions || 0;
  const totalProductClicks = totalsAgg[0]?.totalClicks || 0;
  const overallCtr =
    totalProductImpressions > 0
      ? parseFloat(((totalProductClicks / totalProductImpressions) * 100).toFixed(2))
      : 0;

  // Platform Timeline over the date range
  const dailyTimelineAgg = await StoreDailyAnalytics.aggregate([
    {
      $match: {
        dateStr: { $gte: startStr, $lte: endStr },
      },
    },
    {
      $group: {
        _id: '$dateStr',
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        visits: { $sum: '$visits' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const timelineMap = new Map<string, { impressions: number; clicks: number; visits: number }>();
  dailyTimelineAgg.forEach((d) => {
    timelineMap.set(d._id, {
      impressions: d.impressions,
      clicks: d.clicks,
      visits: d.visits,
    });
  });

  const timeline: Array<{
    date: string;
    formattedDate: string;
    impressions: number;
    clicks: number;
    visits: number;
    ctr: number;
  }> = [];

  const curr = new Date(startDate);
  while (curr <= endDate) {
    const dStr = formatDateYMD(curr);
    const item = timelineMap.get(dStr) || { impressions: 0, clicks: 0, visits: 0 };
    const ctr =
      item.impressions > 0
        ? parseFloat(((item.clicks / item.impressions) * 100).toFixed(2))
        : 0;

    timeline.push({
      date: dStr,
      formattedDate: curr.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      impressions: item.impressions,
      clicks: item.clicks,
      visits: item.visits,
      ctr,
    });
    curr.setDate(curr.getDate() + 1);
  }

  const overviewObj = {
    totalStoreVisits,
    totalProductImpressions,
    totalProductClicks,
    totalActiveMerchants,
    totalProducts,
    overallCtr,
  };

  return {
    overview: overviewObj,
    ...overviewObj,
    timeline,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. Super Admin Dashboard: Merchant-Wise Analytics Table
// ─────────────────────────────────────────────────────────────────────────────
const getAdminMerchants = async (query: any) => {
  const { page, limit, skip } = paginationHelper(query.page, query.limit);
  const { startDate, endDate, startStr, endStr } = getDateRange(query.period || query.range, query.startDate, query.endDate);
  const search = (query.search || '').trim();
  const sortBy = query.sortBy || 'impressions'; // 'impressions' | 'clicks' | 'visits' | 'ctr' | 'products' | 'name'
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

  const tenantFilter: any = {};
  if (search) {
    tenantFilter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { slug: { $regex: search, $options: 'i' } },
      { domain: { $regex: search, $options: 'i' } },
      { customDomain: { $regex: search, $options: 'i' } },
      { contactEmail: { $regex: search, $options: 'i' } },
    ];
  }

  // Aggregate stats per tenant in date range
  const tenantDailyStats = await StoreDailyAnalytics.aggregate([
    {
      $match: {
        dateStr: { $gte: startStr, $lte: endStr },
      },
    },
    {
      $group: {
        _id: '$tenantId',
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        visits: { $sum: '$visits' },
      },
    },
  ]);

  const statsMap = new Map<string, { impressions: number; clicks: number; visits: number }>();
  tenantDailyStats.forEach((s) => {
    if (s._id) {
      statsMap.set(s._id.toString(), {
        impressions: s.impressions,
        clicks: s.clicks,
        visits: s.visits,
      });
    }
  });

  // Legacy store visits fallback in date range
  const legacyVisitsAgg = await StoreVisit.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: '$tenantId',
        visits: { $sum: 1 },
      },
    },
  ]);
  const legacyVisitsMap = new Map<string, number>();
  legacyVisitsAgg.forEach((v) => {
    if (v._id) legacyVisitsMap.set(v._id.toString(), v.visits);
  });

  // Count products per tenant
  const productCountAgg = await Product.aggregate([
    { $group: { _id: '$tenantId', totalProducts: { $sum: 1 } } },
  ]);
  const productCountMap = new Map<string, number>();
  productCountAgg.forEach((p) => {
    if (p._id) productCountMap.set(p._id.toString(), p.totalProducts);
  });

  // Fetch tenants
  const [tenants, total] = await Promise.all([
    Tenant.find(tenantFilter)
      .select('name slug domain customDomain logo status createdAt')
      .lean(),
    Tenant.countDocuments(tenantFilter),
  ]);

  const enrichedMerchants = tenants.map((t) => {
    const stats = statsMap.get(t._id.toString()) || { impressions: 0, clicks: 0, visits: 0 };
    const legacyVisits = legacyVisitsMap.get(t._id.toString()) || 0;
    const effectiveVisits = Math.max(stats.visits, legacyVisits);
    const productsCount = productCountMap.get(t._id.toString()) || 0;
    const ctr =
      stats.impressions > 0
        ? parseFloat(((stats.clicks / stats.impressions) * 100).toFixed(2))
        : 0;

    return {
      _id: t._id,
      tenantId: t._id,
      name: t.name || t.slug,
      storeName: t.name || t.slug,
      slug: t.slug,
      subdomain: t.slug,
      domain: t.domain || `${t.slug}.masheco.com`,
      customDomain: t.customDomain,
      logo: t.logo,
      status: t.status,
      storeVisits: effectiveVisits,
      visits: effectiveVisits,
      impressions: stats.impressions,
      clicks: stats.clicks,
      ctr,
      totalProducts: productsCount,
      productsCount,
      createdAt: (t as any).createdAt,
    };
  });

  enrichedMerchants.sort((a, b) => {
    if (sortBy === 'clicks') return (a.clicks - b.clicks) * sortOrder;
    if (sortBy === 'visits') return (a.storeVisits - b.storeVisits) * sortOrder;
    if (sortBy === 'ctr') return (a.ctr - b.ctr) * sortOrder;
    if (sortBy === 'products') return (a.totalProducts - b.totalProducts) * sortOrder;
    if (sortBy === 'name') return a.name.localeCompare(b.name) * sortOrder;
    return (a.impressions - b.impressions) * sortOrder;
  });

  const paginatedData = enrichedMerchants.slice(skip, skip + limit);

  return {
    data: paginatedData,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const AnalyticsService = {
  trackEvents,
  getMerchantOverview,
  getMerchantTimeline,
  getMerchantTopProducts,
  getMerchantProducts,
  getAdminOverview,
  getAdminMerchants,
};
