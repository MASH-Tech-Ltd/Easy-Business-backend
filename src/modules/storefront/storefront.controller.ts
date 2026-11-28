import { Request, Response } from "express";
import { Tenant } from "../tenant/tenant.model";
import { Product } from "../product/product.model";
import { Category } from "../category/category.model";
import { Theme } from "../theme/theme.model";
import { Subscription } from "../subscription/subscription.model";
import ApiResponse from "../../utils/apiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { Types } from "mongoose";
import { paginationHelper } from "../../helpers/paginationHelper";

import CustomError from "../../helpers/CustomError";
import { CacheService } from "../../services/cache/cache.service";
import { CacheKeys } from "../../services/cache/cache.keys";
import { CACHE_TTL } from "../../services/cache/cache.ttl";
import { CacheInvalidation } from "../../services/cache/cache.invalidation";

export function invalidateStorefrontThemeCache(tenantId: string) {
  if (!tenantId) return;
  void CacheInvalidation.invalidateStoreSettings(tenantId);
}

// Helper to set public CDN / browser caching headers on responses
const setStorefrontCacheHeaders = (res: Response, maxAge = 30, sMaxAge = 60) => {
  res.setHeader('Cache-Control', `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=120`);
};

// Build a robust $or query that matches tenant by slug OR customDomain,
// handling both 'www.domain.com' and 'domain.com' regardless of how it was stored in DB.
const normalizeTenantQuery = (slugOrDomain: string) => {
  const bare = slugOrDomain.replace(/^www\./, '').toLowerCase();
  const withWww = `www.${bare}`;
  const prefixOnly = bare.replace(/\.masheco\.com$/, '');
  const withMasheco = `${prefixOnly}.masheco.com`;
  return {
    $or: [
      { domain: bare },
      { domain: prefixOnly },
      { domain: withMasheco },
      { slug: bare },
      { slug: prefixOnly },
      { customDomain: bare },
      { customDomain: withWww },
    ],
  };
};

// Utility to resolve tenantId from slug or domain with centralized Redis cache
const resolveTenant = async (slugOrDomain: string): Promise<Types.ObjectId> => {
  const normalizedKey = slugOrDomain.replace(/^www\./, '').toLowerCase().trim();
  const cacheKey = CacheKeys.tenantLookup(normalizedKey);
  const { value: cachedIdStr } = await CacheService.getOrSet<string | null>(
    cacheKey,
    async () => {
      const query = normalizeTenantQuery(normalizedKey);
      const tenant = await Tenant.findOne({ ...query, status: 'active' }).select('_id').lean();
      return tenant ? String(tenant._id) : null;
    },
    {
      group: 'storefront',
      ttlSeconds: CACHE_TTL.STORE_SETTINGS,
      shouldCache: (val) => Boolean(val),
    }
  );
  if (!cachedIdStr) throw new CustomError(404, 'Tenant not found');
  return new Types.ObjectId(cachedIdStr);
};

/**
 * Check whether a tenant has an active (non-expired) subscription.
 * Applies lazy expiry: marks status='expired' in DB if endDate has passed.
 * Returns { storeDown, daysLeft, isTrial, reason } with Redis caching.
 */
const checkStoreSubscription = async (tenantId: Types.ObjectId) => {
  const cacheKey = CacheKeys.storeSubscription(tenantId.toString());
  const { value } = await CacheService.getOrSet<any>(
    cacheKey,
    async () => {
      const tenant = await Tenant.findById(tenantId).select("isOnline").lean();
      if (!tenant || tenant.isOnline === false) {
        return {
          storeDown: true,
          daysLeft: 0,
          isTrial: false,
          reason: "Store is offline",
        };
      }

      const now = new Date();

      const sub = await Subscription.findOne(
        {
          tenantId,
          status: { $in: ["active", "pending"] },
          startDate: { $lte: now },
          endDate: { $gte: now },
        },
        null,
        { sort: { endDate: -1 } },
      ).lean();

      if (!sub) {
        const upcoming = await Subscription.findOne(
          { tenantId, status: "active", startDate: { $gt: now } },
          null,
          { sort: { startDate: 1 } }
        ).lean();

        return {
          storeDown: true,
          daysLeft: 0,
          isTrial: false,
          reason: upcoming ? `Plan scheduled to start on ${new Date(upcoming.startDate).toLocaleDateString('en-GB')}` : "No active subscription",
        };
      }

      const end = new Date(sub.endDate);
      const daysLeft = Math.max(
        0,
        Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );

      if (sub.status === "active" && end < now) {
        await Subscription.updateOne({ _id: sub._id }, { $set: { status: "expired" } });
        const reason = sub.isTrial ? "Trial expired" : "Subscription expired";
        return {
          storeDown: true,
          daysLeft: 0,
          isTrial: sub.isTrial ?? false,
          reason,
        };
      }

      return {
        storeDown: false,
        daysLeft,
        isTrial: sub.isTrial ?? false,
        reason: sub.isTrial ? "Trial active" : "Active",
      };
    },
    {
      group: 'storefront',
      ttlSeconds: CACHE_TTL.STORE_STATUS,
    }
  );
  return value;
};

/**
 * Returns IDs of all ACTIVE categories for a tenant.
 * Any category with status === 'DRAFT' or 'INACTIVE' is excluded.
 */
const getActiveCategoryIds = async (tenantId: Types.ObjectId): Promise<Types.ObjectId[]> => {
  const cacheKey = CacheKeys.storeActiveCategoryIds(tenantId.toString());
  const { value: idStrings } = await CacheService.getOrSet<string[]>(
    cacheKey,
    async () => {
      const activeCategories = await Category.find({
        tenantId,
        status: { $nin: ['DRAFT', 'INACTIVE'] },
      }).select('_id').lean();
      return activeCategories.map((c: any) => String(c._id));
    },
    {
      group: 'category',
      ttlSeconds: CACHE_TTL.CATEGORY_ALL,
    }
  );
  return idStrings.map((id) => new Types.ObjectId(id));
};

// ── Controllers ───────────────────────────────────────────────────────────────

const getStatus = asyncHandler(async (req: Request, res: Response) => {
  setStorefrontCacheHeaders(res, 20, 45);
  const tenantSlug = req.params.tenantSlug as string;
  const query = normalizeTenantQuery(tenantSlug);
  const tenant = await Tenant.findOne({ ...query, status: 'active' }).select('_id isOnline customDomain domainStatus').lean();
  if (!tenant) {
    return res.status(404).json({
      success: false,
      data: {
        storeDown: true,
        daysLeft: 0,
        isTrial: false,
        reason: "Store not found",
      },
    });
  }
  if (tenant.isOnline === false) {
    return res.status(200).json({
      success: true,
      data: {
        storeDown: true,
        daysLeft: 0,
        isTrial: false,
        reason: "Store is offline",
        customDomain: tenant.customDomain || null,
        domainStatus: tenant.domainStatus || null,
      },
    });
  }
  const status = await checkStoreSubscription(tenant._id as Types.ObjectId);
  return res.status(200).json({
    success: true,
    data: {
      ...status,
      customDomain: tenant.customDomain || null,
      domainStatus: tenant.domainStatus || null,
    },
  });
});

const getTheme = asyncHandler(async (req: Request, res: Response) => {
  setStorefrontCacheHeaders(res, 30, 60);
  const tenantSlug = req.params.tenantSlug as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res
      .status(402)
      .json({
        success: false,
        storeDown: true,
        message: "Store subscription inactive or expired",
      });
  }

  const cacheKey = CacheKeys.storeTheme(tenantId.toString());
  const { value: themeData, hit } = await CacheService.getOrSet<any>(
    cacheKey,
    async () => {
      const theme = await Theme.findOne({ tenantId }).lean();
      if (!theme) {
        return {
          isDefault: true,
          theme: {
            primaryColor: "#5022C3",
            fontFamily: "Inter",
            storeTitleFont: "Inter",
            themeId: "light",
          },
        };
      }
      return { isDefault: false, theme };
    },
    {
      group: 'storefront',
      ttlSeconds: CACHE_TTL.STORE_SETTINGS,
    }
  );

  res.locals.cacheStatus = hit ? 'HIT' : 'MISS';
  res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  if (themeData.isDefault) {
    return ApiResponse.sendSuccess(res, 200, "Default Theme", themeData.theme);
  }
  ApiResponse.sendSuccess(res, 200, "Theme retrieved successfully", themeData.theme);
});

const getProducts = asyncHandler(async (req: Request, res: Response) => {
  setStorefrontCacheHeaders(res, 15, 30);
  const tenantSlug = req.params.tenantSlug as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res
      .status(402)
      .json({
        success: false,
        storeDown: true,
        message: "Store subscription inactive or expired",
      });
  }

  const {
    limit,
    page,
    categoryId,
    search,
    minPrice,
    maxPrice,
    inStock,
    sort,
    brand,
  } = req.query;

  // Cap limit at 100 — prevents client from dumping entire catalog in one request
  const rawPageLimit = parseInt((limit as string) || '20', 10);
  const safeLimit = Math.min(Math.max(1, isNaN(rawPageLimit) ? 20 : rawPageLimit), 100);
  const {
    page: pageNum,
    limit: limitNum,
    skip,
  } = paginationHelper(page as string, String(safeLimit));

  // Cache deterministic product listings & searches in Redis (skip 'random' sort)
  const storeIdStr = tenantId.toString();
  if (sort !== "random") {
    const prodVer = await CacheService.getVersion(CacheKeys.storeProductVersion(storeIdStr));
    const listCacheKey = CacheKeys.storeProductsList(storeIdStr, prodVer, {
      page: pageNum,
      limit: limitNum,
      sort,
      categoryId,
      minPrice,
      maxPrice,
      inStock,
      brand,
      search,
    });
    const ttlSeconds = search ? CACHE_TTL.PRODUCT_SEARCH : CACHE_TTL.PRODUCT_LISTING;

    const { value: cachedPayload, hit } = await CacheService.getOrSet<{
      data: any[];
      pagination: { total: number; page: number; totalPages: number };
    }>(
      listCacheKey,
      async () => {
        const activeCategoryIds = await getActiveCategoryIds(tenantId);
        const query: any = {
          tenantId,
          status: "ACTIVE",
          categoryId: { $in: activeCategoryIds },
        };

        if (categoryId) {
          const rawCatStr = String(categoryId).trim();
          let requestedCatId: Types.ObjectId | null = null;
          if (Types.ObjectId.isValid(rawCatStr)) {
            requestedCatId = new Types.ObjectId(rawCatStr);
          } else {
            const foundCat = await Category.findOne({
              tenantId,
              slug: rawCatStr,
              status: { $nin: ['DRAFT', 'INACTIVE'] },
            }).select("_id").lean();
            if (foundCat) {
              requestedCatId = foundCat._id as Types.ObjectId;
            }
          }

          if (requestedCatId && activeCategoryIds.some((id) => id.equals(requestedCatId!))) {
            query.categoryId = requestedCatId;
          } else {
            query.categoryId = new Types.ObjectId();
          }
        }

        if (search) {
          const safeSearch = (search as string).slice(0, 100);
          const matchingCategories = await Category.find({
            tenantId,
            status: { $nin: ['DRAFT', 'INACTIVE'] },
            name: { $regex: safeSearch, $options: "i" },
          }).select("_id").lean();
          const categoryIds = matchingCategories.map((c) => c._id as Types.ObjectId);

          query.$and = [
            { categoryId: { $in: activeCategoryIds } },
            {
              $or: [
                { title: { $regex: safeSearch, $options: "i" } },
                { brand: { $regex: safeSearch, $options: "i" } },
                { categoryId: { $in: categoryIds } },
              ],
            },
          ];
          delete query.categoryId;
        }
        if (brand) query.brand = { $regex: (brand as string).slice(0, 50), $options: "i" };
        if (inStock === "true") {
          query.stock = { $gt: 0 };
        }
        if (minPrice !== undefined || maxPrice !== undefined) {
          query.discountedPrice = {};
          if (minPrice !== undefined) query.discountedPrice.$gte = Number(minPrice);
          if (maxPrice !== undefined) query.discountedPrice.$lte = Number(maxPrice);
        }

        const matchQuery: any = { ...query };
        if (matchQuery.tenantId && typeof matchQuery.tenantId === 'string') {
          matchQuery.tenantId = new Types.ObjectId(matchQuery.tenantId);
        }
        if (matchQuery.categoryId && typeof matchQuery.categoryId === 'string' && Types.ObjectId.isValid(matchQuery.categoryId)) {
          matchQuery.categoryId = new Types.ObjectId(matchQuery.categoryId);
        }

        let secondarySort: any = { createdAt: -1 };
        if (sort === "price_asc") secondarySort = { discountedPrice: 1 };
        else if (sort === "price_desc") secondarySort = { discountedPrice: -1 };
        else if (sort === "newest") secondarySort = { createdAt: -1 };
        else if (sort === "discount_desc") secondarySort = { saveAmount: -1 };
        else if (sort === "brand") secondarySort = { brand: 1 };

        const pipeline: any[] = [
          { $match: matchQuery },
          {
            $addFields: {
              inStockSort: {
                $cond: [{ $gt: [{ $ifNull: ["$stock", 0] }, 0] }, 1, 0]
              }
            }
          },
          { $sort: { inStockSort: -1, ...secondarySort } },
          { $skip: skip },
          { $limit: limitNum }
        ];

        const [rawProducts, total] = await Promise.all([
          Product.aggregate(pipeline),
          Product.countDocuments(query),
        ]);

        const products = await Product.populate(rawProducts, { path: "categoryId" });
        return {
          data: products,
          pagination: {
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum),
          },
        };
      },
      {
        group: 'product',
        ttlSeconds,
      }
    );

    res.locals.cacheStatus = hit ? 'HIT' : 'MISS';
    res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    return ApiResponse.sendSuccess(res, 200, "Products retrieved successfully", cachedPayload);
  }

  // Random sort path (uncached by design)
  res.locals.cacheStatus = 'BYPASS';
  const activeCategoryIds = await getActiveCategoryIds(tenantId);

  const query: any = {
    tenantId,
    status: "ACTIVE",
    categoryId: { $in: activeCategoryIds },
  };

  if (categoryId) {
    const rawCatStr = String(categoryId).trim();
    let requestedCatId: Types.ObjectId | null = null;
    if (Types.ObjectId.isValid(rawCatStr)) {
      requestedCatId = new Types.ObjectId(rawCatStr);
    } else {
      const foundCat = await Category.findOne({
        tenantId,
        slug: rawCatStr,
        status: { $nin: ['DRAFT', 'INACTIVE'] },
      }).select("_id").lean();
      if (foundCat) {
        requestedCatId = foundCat._id as Types.ObjectId;
      }
    }

    if (requestedCatId && activeCategoryIds.some((id) => id.equals(requestedCatId!))) {
      query.categoryId = requestedCatId;
    } else {
      query.categoryId = new Types.ObjectId();
    }
  }

  if (brand) query.brand = { $regex: (brand as string).slice(0, 50), $options: "i" };
  if (inStock === "true") query.stock = { $gt: 0 };
  if (minPrice !== undefined || maxPrice !== undefined) {
    query.discountedPrice = {};
    if (minPrice !== undefined) query.discountedPrice.$gte = Number(minPrice);
    if (maxPrice !== undefined) query.discountedPrice.$lte = Number(maxPrice);
  }

  const matchQuery: any = { ...query };
  const inStockMatch = { ...matchQuery, stock: { $gt: 0 } };
  const outOfStockMatch = { ...matchQuery, $or: [{ stock: { $lte: 0 } }, { stock: null }] };

  const inStockCount = await Product.countDocuments(inStockMatch);
  let sampleDocs: any[] = [];

  if (inStockCount > 0) {
    sampleDocs = await Product.aggregate([
      { $match: inStockMatch },
      { $sample: { size: limitNum } }
    ]);
  }

  if (sampleDocs.length < limitNum) {
    const needed = limitNum - sampleDocs.length;
    const outOfStockRandom = await Product.aggregate([
      { $match: outOfStockMatch },
      { $sample: { size: needed } }
    ]);
    sampleDocs = [...sampleDocs, ...outOfStockRandom];
  }

  const populatedDocs = await Product.populate(sampleDocs, { path: "categoryId" });
  const total = await Product.countDocuments(query);

  return ApiResponse.sendSuccess(res, 200, "Products retrieved successfully", {
    data: populatedDocs,
    pagination: {
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

const getBestsellingProducts = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantSlug = req.params.tenantSlug as string;
    const tenantId = await resolveTenant(tenantSlug);
    const { storeDown } = await checkStoreSubscription(tenantId);
    if (storeDown) {
      return res
        .status(402)
        .json({
          success: false,
          storeDown: true,
          message: "Store subscription inactive or expired",
        });
    }

    // Cap at 50 — prevents client from requesting arbitrarily large result sets
    const rawLimit = parseInt((req.query.limit as string) || '8', 10);
    const limitNum = Math.min(Math.max(1, isNaN(rawLimit) ? 8 : rawLimit), 50);

    const storeIdStr = tenantId.toString();
    const prodVer = await CacheService.getVersion(CacheKeys.storeProductVersion(storeIdStr));
    const cacheKey = CacheKeys.storeBestsellers(storeIdStr, prodVer, limitNum);
    const { value: bestsellers, hit } = await CacheService.getOrSet<any[]>(
      cacheKey,
      async () => {
        const activeCategoryIds = await getActiveCategoryIds(tenantId);
        return Product.find({
          tenantId,
          status: "ACTIVE",
          categoryId: { $in: activeCategoryIds },
          salesCount: { $gt: 20 },
          stock: { $gt: 0 },
        })
          .populate("categoryId")
          .sort({ salesCount: -1, createdAt: -1 })
          .limit(limitNum)
          .lean();
      },
      {
        group: 'product',
        ttlSeconds: CACHE_TTL.PRODUCT_FEATURED,
      }
    );

    res.locals.cacheStatus = hit ? 'HIT' : 'MISS';
    res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    setStorefrontCacheHeaders(res, 20, 45);
    ApiResponse.sendSuccess(
      res,
      200,
      "Bestselling products retrieved successfully",
      {
        data: bestsellers,
      },
    );
  },
);

const getNewArrivals = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantSlug = req.params.tenantSlug as string;
    const tenantId = await resolveTenant(tenantSlug);
    const { storeDown } = await checkStoreSubscription(tenantId);
    if (storeDown) {
      return res
        .status(402)
        .json({
          success: false,
          storeDown: true,
          message: "Store subscription inactive or expired",
        });
    }

    const rawLimit = parseInt((req.query.limit as string) || '8', 10);
    const limitNum = Math.min(Math.max(1, isNaN(rawLimit) ? 8 : rawLimit), 50);

    const storeIdStr = tenantId.toString();
    const prodVer = await CacheService.getVersion(CacheKeys.storeProductVersion(storeIdStr));
    const cacheKey = CacheKeys.storeNewArrivals(storeIdStr, prodVer, limitNum);
    const { value: newArrivals, hit } = await CacheService.getOrSet<any[]>(
      cacheKey,
      async () => {
        const activeCategoryIds = await getActiveCategoryIds(tenantId);
        return Product.find({
          tenantId,
          status: "ACTIVE",
          categoryId: { $in: activeCategoryIds },
          stock: { $gt: 0 },
        })
          .populate("categoryId")
          .sort({ createdAt: -1 })
          .limit(limitNum)
          .lean();
      },
      {
        group: 'product',
        ttlSeconds: CACHE_TTL.PRODUCT_FEATURED,
      }
    );

    res.locals.cacheStatus = hit ? 'HIT' : 'MISS';
    res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    setStorefrontCacheHeaders(res, 20, 45);
    ApiResponse.sendSuccess(
      res,
      200,
      "New arrival products retrieved successfully",
      {
        data: newArrivals,
      },
    );
  },
);

const getJustForYouProducts = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantSlug = req.params.tenantSlug as string;
    const tenantId = await resolveTenant(tenantSlug);
    const { storeDown } = await checkStoreSubscription(tenantId);
    if (storeDown) {
      return res
        .status(402)
        .json({
          success: false,
          storeDown: true,
          message: "Store subscription inactive or expired",
        });
    }

    // Cap at 50 — prevents client from requesting arbitrarily large result sets
    const rawLimit = parseInt((req.query.limit as string) || '8', 10);
    const limitNum = Math.min(Math.max(1, isNaN(rawLimit) ? 8 : rawLimit), 50);

    // For storefront only: exclude products whose category is DRAFT or INACTIVE
    const activeCategoryIds = await getActiveCategoryIds(tenantId);

    const objectTenantId = new Types.ObjectId(tenantId);
    const inStockDocs = await Product.aggregate([
      {
        $match: {
          tenantId: objectTenantId,
          status: "ACTIVE",
          categoryId: { $in: activeCategoryIds },
          $expr: {
            $gt: [
              { $convert: { input: "$stock", to: "int", onError: 0, onNull: 0 } },
              0
            ]
          }
        }
      },
      { $sample: { size: limitNum } },
    ]);
    let randomDocs = inStockDocs;

    if (randomDocs.length < limitNum) {
      const needed = limitNum - randomDocs.length;
      const outOfStockDocs = await Product.aggregate([
        {
          $match: {
            tenantId: objectTenantId,
            status: "ACTIVE",
            categoryId: { $in: activeCategoryIds },
            $expr: {
              $lte: [
                { $convert: { input: "$stock", to: "int", onError: 0, onNull: 0 } },
                0
              ]
            }
          }
        },
        { $sample: { size: needed } },
      ]);
      randomDocs = [...randomDocs, ...outOfStockDocs];
    }

    const populatedDocs = await Product.populate(randomDocs, {
      path: "categoryId",
    });

    setStorefrontCacheHeaders(res, 20, 45);
    ApiResponse.sendSuccess(
      res,
      200,
      "Just For You products retrieved successfully",
      {
        data: populatedDocs,
      },
    );
  },
);

const getProductBySlug = asyncHandler(async (req: Request, res: Response) => {
  setStorefrontCacheHeaders(res, 20, 45);
  const tenantSlug = req.params.tenantSlug as string;
  const slug = req.params.slug as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res
      .status(402)
      .json({
        success: false,
        storeDown: true,
        message: "Store subscription inactive or expired",
      });
  }

  let decodedSlug = slug;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    decodedSlug = slug;
  }

  const cacheKey = CacheKeys.storeProductBySlug(tenantId.toString(), decodedSlug);
  const { value: product, hit } = await CacheService.getOrSet<any>(
    cacheKey,
    async () => {
      const activeCategoryIds = await getActiveCategoryIds(tenantId);
      const slugOrConditions: any[] = [
        { slug },
        { slug: decodedSlug },
        { slug: slug.trim() },
        { slug: decodedSlug.trim() },
      ];
      if (Types.ObjectId.isValid(decodedSlug.trim())) {
        slugOrConditions.push({ _id: new Types.ObjectId(decodedSlug.trim()) });
      }

      return Product.findOne({
        tenantId,
        status: "ACTIVE",
        categoryId: { $in: activeCategoryIds },
        $or: slugOrConditions,
      }).populate("categoryId").lean();
    },
    {
      group: 'product',
      ttlSeconds: CACHE_TTL.PRODUCT_DETAIL,
      shouldCache: (doc) => Boolean(doc),
    }
  );

  res.locals.cacheStatus = hit ? 'HIT' : 'MISS';
  res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  if (!product) {
    return ApiResponse.sendError(res, 404, "Product not found");
  }
  ApiResponse.sendSuccess(res, 200, "Product retrieved successfully", product);
});

const getCategories = asyncHandler(async (req: Request, res: Response) => {
  setStorefrontCacheHeaders(res, 30, 60);
  const tenantSlug = req.params.tenantSlug as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res
      .status(402)
      .json({
        success: false,
        storeDown: true,
        message: "Store subscription inactive or expired",
      });
  }

  const storeIdStr = tenantId.toString();
  const catVer = await CacheService.getVersion(CacheKeys.storeCategoryVersion(storeIdStr));
  const cacheKey = CacheKeys.storeCategoriesAll(storeIdStr, catVer);
  const { value: categories, hit } = await CacheService.getOrSet<any[]>(
    cacheKey,
    async () => {
      return Category.find({
        tenantId,
        status: { $nin: ['DRAFT', 'INACTIVE'] },
      }).lean();
    },
    {
      group: 'category',
      ttlSeconds: CACHE_TTL.CATEGORY_ALL,
    }
  );

  res.locals.cacheStatus = hit ? 'HIT' : 'MISS';
  res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  ApiResponse.sendSuccess(
    res,
    200,
    "Categories retrieved successfully",
    categories,
  );
});

const getBrands = asyncHandler(async (req: Request, res: Response) => {
  setStorefrontCacheHeaders(res, 30, 60);
  const tenantSlug = req.params.tenantSlug as string;
  const categoryId = req.query.categoryId as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res
      .status(200)
      .json({
        success: false,
        storeDown: true,
        message: "Store subscription inactive or expired",
      });
  }

  const storeIdStr = tenantId.toString();
  const prodVer = await CacheService.getVersion(CacheKeys.storeProductVersion(storeIdStr));
  const cacheKey = CacheKeys.storeBrands(storeIdStr, prodVer, categoryId || 'all');
  const { value: brands, hit } = await CacheService.getOrSet<string[]>(
    cacheKey,
    async () => {
      const activeCategoryIds = await getActiveCategoryIds(tenantId);
      const query: any = {
        tenantId,
        status: "ACTIVE",
        categoryId: { $in: activeCategoryIds },
        brand: { $nin: [null, ""] },
      };
      if (categoryId) {
        const rawCatStr = String(categoryId).trim();
        if (Types.ObjectId.isValid(rawCatStr) && activeCategoryIds.some((id) => id.toString() === rawCatStr)) {
          query.categoryId = new Types.ObjectId(rawCatStr);
        } else {
          query.categoryId = new Types.ObjectId();
        }
      }
      const list = await Product.distinct("brand", query);
      list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      return list;
    },
    {
      group: 'product',
      ttlSeconds: CACHE_TTL.PRODUCT_DETAIL,
    }
  );

  res.locals.cacheStatus = hit ? 'HIT' : 'MISS';
  res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  ApiResponse.sendSuccess(res, 200, "Brands retrieved successfully", brands);
});

const getInfo = asyncHandler(async (req: Request, res: Response) => {
  setStorefrontCacheHeaders(res, 30, 60);
  const tenantSlug = req.params.tenantSlug as string;
  const normalizedKey = tenantSlug.replace(/^www\./, '').toLowerCase().trim();
  const cacheKey = CacheKeys.storeInfo(normalizedKey);
  const { value: tenant, hit } = await CacheService.getOrSet<any>(
    cacheKey,
    async () => {
      const query = normalizeTenantQuery(normalizedKey);
      return Tenant.findOne({ ...query, status: 'active' })
        .select('name logo slug domain customDomain domainStatus settings description')
        .lean();
    },
    {
      group: 'storefront',
      ttlSeconds: CACHE_TTL.STORE_SETTINGS,
      shouldCache: (doc) => Boolean(doc),
    }
  );

  res.locals.cacheStatus = hit ? 'HIT' : 'MISS';
  res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  if (!tenant) {
    // We MUST return 200 here. Next.js ISR ignores 404s and will keep the stale cache!
    return res
      .status(200)
      .json({ success: true, data: null, message: "Tenant not found" });
  }

  ApiResponse.sendSuccess(
    res,
    200,
    "Tenant info retrieved successfully",
    tenant,
  );
});

export const StorefrontController = {
  getStatus,
  getInfo,
  getTheme,
  getProducts,
  getBestsellingProducts,
  getNewArrivals,
  getJustForYouProducts,
  getProductBySlug,
  getCategories,
  getBrands,
};
