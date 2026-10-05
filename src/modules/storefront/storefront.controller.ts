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

// Build a robust $or query that matches tenant by slug OR customDomain,
// handling both 'www.domain.com' and 'domain.com' regardless of how it was stored in DB.
const normalizeTenantQuery = (slugOrDomain: string) => {
  const bare = slugOrDomain.replace(/^www\./, '').toLowerCase();
  const withWww = `www.${bare}`;
  return {
    $or: [
      { slug: bare },
      { customDomain: bare },
      { customDomain: withWww },
    ],
  };
};

// Utility to resolve tenantId from slug or domain
const resolveTenant = async (slugOrDomain: string) => {
  const query = normalizeTenantQuery(slugOrDomain);
  const tenant = await Tenant.findOne({ ...query, status: 'active' });
  if (!tenant) throw new CustomError(404, 'Tenant not found');
  return tenant._id as Types.ObjectId;
};

/**
 * Check whether a tenant has an active (non-expired) subscription.
 * Applies lazy expiry: marks status='expired' in DB if endDate has passed.
 * Returns { storeDown, daysLeft, isTrial, reason }
 */
const checkStoreSubscription = async (tenantId: Types.ObjectId) => {
  const tenant = await Tenant.findById(tenantId).select("isOnline");
  if (!tenant || tenant.isOnline === false) {
    return {
      storeDown: true,
      daysLeft: 0,
      isTrial: false,
      reason: "Store is offline",
    };
  }

  const sub = await Subscription.findOne(
    { tenantId, status: { $in: ["active", "pending"] } },
    null,
    { sort: { endDate: -1 } },
  );

  if (!sub) {
    return {
      storeDown: true,
      daysLeft: 0,
      isTrial: false,
      reason: "No active subscription",
    };
  }

  const now = new Date();
  const end = new Date(sub.endDate);
  const daysLeft = Math.max(
    0,
    Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );

  // Lazy expiry
  if (sub.status === "active" && end < now) {
    sub.status = "expired";
    await sub.save();
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
};

// ── Controllers ───────────────────────────────────────────────────────────────

const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const query = normalizeTenantQuery(tenantSlug);
  const tenant = await Tenant.findOne({ ...query, status: 'active' });
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
      },
    });
  }
  const status = await checkStoreSubscription(tenant._id as Types.ObjectId);
  return res.status(200).json({ success: true, data: status });
});

const getTheme = asyncHandler(async (req: Request, res: Response) => {
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
  const theme = await Theme.findOne({ tenantId });
  if (!theme) {
    return ApiResponse.sendSuccess(res, 200, "Default Theme", {
      primaryColor: "#5022C3",
      fontFamily: "Inter",
      themeId: "light",
    });
  }
  ApiResponse.sendSuccess(res, 200, "Theme retrieved successfully", theme);
});

const getProducts = asyncHandler(async (req: Request, res: Response) => {
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

  const query: any = { tenantId, status: "ACTIVE" };
  if (categoryId) {
    const rawCatStr = String(categoryId).trim();
    if (Types.ObjectId.isValid(rawCatStr)) {
      query.categoryId = new Types.ObjectId(rawCatStr);
    } else {
      const foundCat = await Category.findOne({ tenantId, slug: rawCatStr }).select("_id");
      if (foundCat) {
        query.categoryId = foundCat._id;
      } else {
        query.categoryId = rawCatStr;
      }
    }
  }
  if (search) {
    // Sanitize: cap length to 100 chars to prevent ReDoS on unbounded $regex patterns
    const safeSearch = (search as string).slice(0, 100);
    const matchingCategories = await Category.find({
      tenantId,
      name: { $regex: safeSearch, $options: "i" },
    }).select("_id");
    const categoryIds = matchingCategories.map((c) => c._id);

    query.$or = [
      { title: { $regex: safeSearch, $options: "i" } },
      { brand: { $regex: safeSearch, $options: "i" } },
      { categoryId: { $in: categoryIds } },
    ];
  }
  if (brand) query.brand = { $regex: (brand as string).slice(0, 50), $options: "i" };
  if (inStock === "true") {
    query.$expr = {
      $gt: [{ $convert: { input: "$stock", to: "int", onError: 0, onNull: 0 } }, 0]
    };
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    query.discountedPrice = {};
    if (minPrice !== undefined) query.discountedPrice.$gte = Number(minPrice);
    if (maxPrice !== undefined) query.discountedPrice.$lte = Number(maxPrice);
  }

  // Cap limit at 100 — prevents client from dumping entire catalog in one request
  const rawPageLimit = parseInt((limit as string) || '20', 10);
  const safeLimit = Math.min(Math.max(1, isNaN(rawPageLimit) ? 20 : rawPageLimit), 100);
  const {
    page: pageNum,
    limit: limitNum,
    skip,
  } = paginationHelper(page as string, String(safeLimit));

  const matchQuery: any = { ...query };
  if (matchQuery.tenantId && typeof matchQuery.tenantId === 'string') {
    matchQuery.tenantId = new Types.ObjectId(matchQuery.tenantId);
  }
  if (matchQuery.categoryId && typeof matchQuery.categoryId === 'string' && Types.ObjectId.isValid(matchQuery.categoryId)) {
    matchQuery.categoryId = new Types.ObjectId(matchQuery.categoryId);
  }

  if (sort === "random") {
    const inStockMatch = {
      ...matchQuery,
      $expr: {
        $gt: [
          { $convert: { input: "$stock", to: "int", onError: 0, onNull: 0 } },
          0
        ]
      }
    };
    const outOfStockMatch = {
      ...matchQuery,
      $expr: {
        $lte: [
          { $convert: { input: "$stock", to: "int", onError: 0, onNull: 0 } },
          0
        ]
      }
    };

    const inStockCount = await Product.countDocuments(inStockMatch);
    let sampleDocs: any[] = [];

    if (inStockCount > 0) {
      const inStockRandom = await Product.aggregate([
        { $match: inStockMatch },
        { $sample: { size: limitNum } }
      ]);
      sampleDocs = inStockRandom;
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
          $cond: [
            {
              $gt: [
                {
                  $convert: {
                    input: "$stock",
                    to: "int",
                    onError: 0,
                    onNull: 0
                  }
                },
                0
              ]
            },
            1,
            0
          ]
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

  ApiResponse.sendSuccess(res, 200, "Products retrieved successfully", {
    data: products,
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

    const bestsellers = await Product.find({ 
      tenantId, 
      status: "ACTIVE", 
      salesCount: { $gt: 20 },
      $expr: {
        $gt: [
          { $convert: { input: "$stock", to: "int", onError: 0, onNull: 0 } },
          0
        ]
      }
    })
      .populate("categoryId")
      .sort({ salesCount: -1, createdAt: -1 })
      .limit(limitNum);

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

    const newArrivals = await Product.find({
      tenantId,
      status: "ACTIVE",
      $expr: {
        $gt: [
          { $convert: { input: "$stock", to: "int", onError: 0, onNull: 0 } },
          0
        ]
      }
    })
      .populate("categoryId")
      .sort({ createdAt: -1 })
      .limit(limitNum);

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

    const objectTenantId = new Types.ObjectId(tenantId);
    const inStockDocs = await Product.aggregate([
      {
        $match: {
          tenantId: objectTenantId,
          status: "ACTIVE",
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
  const product = await Product.findOne({
    tenantId,
    slug,
    status: "ACTIVE",
  }).populate("categoryId");
  if (!product) {
    return ApiResponse.sendError(res, 404, "Product not found");
  }
  ApiResponse.sendSuccess(res, 200, "Product retrieved successfully", product);
});

const getCategories = asyncHandler(async (req: Request, res: Response) => {
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
  const categories = await Category.find({ tenantId });
  ApiResponse.sendSuccess(
    res,
    200,
    "Categories retrieved successfully",
    categories,
  );
});

const getBrands = asyncHandler(async (req: Request, res: Response) => {
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
  const query: any = {
    tenantId,
    status: "ACTIVE",
    brand: { $nin: [null, ""] },
  };
  if (categoryId) query.categoryId = categoryId;
  const brands = await Product.distinct("brand", query);
  brands.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  ApiResponse.sendSuccess(res, 200, "Brands retrieved successfully", brands);
});

const getInfo = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const query = normalizeTenantQuery(tenantSlug);
  const tenant = await Tenant.findOne({ ...query, status: 'active' })
    .select('name logo slug customDomain settings description');
  if (!tenant) {
    // We MUST return 200 here. Next.js ISR ignores 404s and will keep the stale cache!
    return res
      .status(200)
      .json({ success: true, data: null, message: "Tenant not found" });
  }
  // getInfo is intentionally NOT blocked by subscription — the storefront app needs tenant info
  // even to display the "store down" page (e.g. store name, logo).
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
