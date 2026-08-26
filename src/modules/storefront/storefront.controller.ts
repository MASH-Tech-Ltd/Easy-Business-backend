import { Request, Response } from 'express';
import { Tenant } from '../tenant/tenant.model';
import { Product } from '../product/product.model';
import { Category } from '../category/category.model';
import { Theme } from '../theme/theme.model';
import { Subscription } from '../subscription/subscription.model';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { Types } from 'mongoose';
import { paginationHelper } from '../../helpers/paginationHelper';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Utility to resolve tenantId from slug
const resolveTenant = async (slug: string) => {
  const tenant = await Tenant.findOne({ slug, status: 'active' });
  if (!tenant) throw new Error('Tenant not found');
  return tenant._id as Types.ObjectId;
};

/**
 * Check whether a tenant has an active (non-expired) subscription.
 * Applies lazy expiry: marks status='expired' in DB if endDate has passed.
 * Returns { storeDown, daysLeft, isTrial, reason }
 */
const checkStoreSubscription = async (tenantId: Types.ObjectId) => {
  const sub = await Subscription.findOne(
    { tenantId, status: { $in: ['active', 'pending'] } },
    null,
    { sort: { createdAt: -1 } }
  );

  if (!sub) {
    return { storeDown: true, daysLeft: 0, isTrial: false, reason: 'No active subscription' };
  }

  const now = new Date();
  const end = new Date(sub.endDate);
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  // Lazy expiry
  if (sub.status === 'active' && end < now) {
    sub.status = 'expired';
    await sub.save();
    return { storeDown: true, daysLeft: 0, isTrial: sub.isTrial ?? false, reason: 'Subscription expired' };
  }

  return {
    storeDown: false,
    daysLeft,
    isTrial: sub.isTrial ?? false,
    reason: 'Active',
  };
};

// ── Controllers ───────────────────────────────────────────────────────────────

const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const tenant = await Tenant.findOne({ slug: tenantSlug, status: 'active' });
  if (!tenant) {
    return res.status(200).json({
      success: true,
      data: { storeDown: true, daysLeft: 0, isTrial: false, reason: 'Store not found' },
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
    return res.status(402).json({ success: false, storeDown: true, message: 'Store subscription inactive or expired' });
  }
  const theme = await Theme.findOne({ tenantId });
  if (!theme) {
    return ApiResponse.sendSuccess(res, 200, 'Default Theme', {
      primaryColor: '#5022C3',
      fontFamily: 'Inter',
      themeId: 'light'
    });
  }
  ApiResponse.sendSuccess(res, 200, 'Theme retrieved successfully', theme);
});

const getProducts = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res.status(402).json({ success: false, storeDown: true, message: 'Store subscription inactive or expired' });
  }

  const { limit, page, categoryId, search, minPrice, maxPrice, inStock, sort, brand } = req.query;

  const query: any = { tenantId, status: 'ACTIVE' };
  if (categoryId) query.categoryId = categoryId;
  if (search) {
    const matchingCategories = await Category.find({
      tenantId,
      name: { $regex: search as string, $options: 'i' }
    }).select('_id');
    const categoryIds = matchingCategories.map(c => c._id);

    query.$or = [
      { title: { $regex: search as string, $options: 'i' } },
      { brand: { $regex: search as string, $options: 'i' } },
      { categoryId: { $in: categoryIds } }
    ];
  }
  if (brand) query.brand = { $regex: brand as string, $options: 'i' };
  if (inStock === 'true') query.stock = { $gt: 0 };
  if (minPrice !== undefined || maxPrice !== undefined) {
    query.discountedPrice = {};
    if (minPrice !== undefined) query.discountedPrice.$gte = Number(minPrice);
    if (maxPrice !== undefined) query.discountedPrice.$lte = Number(maxPrice);
  }

  const { page: pageNum, limit: limitNum, skip } = paginationHelper(page as string, (limit as string) || 20);

  if (sort === 'random') {
    const randomDocs = await Product.aggregate([
      { $match: query },
      { $sample: { size: Number(limitNum) } }
    ]);
    const populatedDocs = await Product.populate(randomDocs, { path: 'categoryId' });
    const total = await Product.countDocuments(query);

    return ApiResponse.sendSuccess(res, 200, 'Products retrieved successfully', {
      data: populatedDocs,
      pagination: { total, page: pageNum, totalPages: Math.ceil(total / limitNum) }
    });
  }

  let productsQuery = Product.find(query).populate('categoryId');
  if (sort === 'price_asc') productsQuery = productsQuery.sort({ discountedPrice: 1 });
  else if (sort === 'price_desc') productsQuery = productsQuery.sort({ discountedPrice: -1 });
  else if (sort === 'newest') productsQuery = productsQuery.sort({ createdAt: -1 });
  else if (sort === 'discount_desc') productsQuery = productsQuery.sort({ saveAmount: -1 });
  else if (sort === 'brand') productsQuery = productsQuery.sort({ brand: 1 });
  else productsQuery = productsQuery.sort({ createdAt: -1 });

  productsQuery = productsQuery.skip(skip).limit(limitNum);

  const [products, total] = await Promise.all([productsQuery, Product.countDocuments(query)]);

  ApiResponse.sendSuccess(res, 200, 'Products retrieved successfully', {
    data: products,
    pagination: { total, page: pageNum, totalPages: Math.ceil(total / limitNum) }
  });
});

const getBestsellingProducts = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res.status(402).json({ success: false, storeDown: true, message: 'Store subscription inactive or expired' });
  }

  const limitNum = req.query.limit ? parseInt(req.query.limit as string) : 8;
  const bestsellers = await Product.find({ tenantId, status: 'ACTIVE' })
    .populate('categoryId')
    .sort({ salesCount: -1 })
    .limit(limitNum);

  ApiResponse.sendSuccess(res, 200, 'Bestselling products retrieved successfully', {
    data: bestsellers
  });
});

const getJustForYouProducts = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res.status(402).json({ success: false, storeDown: true, message: 'Store subscription inactive or expired' });
  }

  const limitNum = req.query.limit ? parseInt(req.query.limit as string) : 8;
  const randomDocs = await Product.aggregate([
    { $match: { tenantId, status: 'ACTIVE' } },
    { $sample: { size: limitNum } }
  ]);
  const populatedDocs = await Product.populate(randomDocs, { path: 'categoryId' });

  ApiResponse.sendSuccess(res, 200, 'Just For You products retrieved successfully', {
    data: populatedDocs
  });
});

const getProductBySlug = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const slug = req.params.slug as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res.status(402).json({ success: false, storeDown: true, message: 'Store subscription inactive or expired' });
  }
  const product = await Product.findOne({ tenantId, slug, status: 'ACTIVE' }).populate('categoryId');
  if (!product) {
    return ApiResponse.sendError(res, 404, 'Product not found');
  }
  ApiResponse.sendSuccess(res, 200, 'Product retrieved successfully', product);
});

const getCategories = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res.status(402).json({ success: false, storeDown: true, message: 'Store subscription inactive or expired' });
  }
  const categories = await Category.find({ tenantId });
  ApiResponse.sendSuccess(res, 200, 'Categories retrieved successfully', categories);
});

const getBrands = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const categoryId = req.query.categoryId as string;
  const tenantId = await resolveTenant(tenantSlug);
  const { storeDown } = await checkStoreSubscription(tenantId);
  if (storeDown) {
    return res.status(402).json({ success: false, storeDown: true, message: 'Store subscription inactive or expired' });
  }
  const query: any = { tenantId, status: 'ACTIVE', brand: { $nin: [null, ''] } };
  if (categoryId) query.categoryId = categoryId;
  const brands = await Product.distinct('brand', query);
  brands.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  ApiResponse.sendSuccess(res, 200, 'Brands retrieved successfully', brands);
});

const getInfo = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const tenant = await Tenant.findOne({ slug: tenantSlug, status: 'active' }).select('name logo slug domain settings');
  if (!tenant) {
    return ApiResponse.sendError(res, 404, 'Tenant not found');
  }
  // getInfo is intentionally NOT blocked by subscription — the storefront app needs tenant info
  // even to display the "store down" page (e.g. store name, logo).
  ApiResponse.sendSuccess(res, 200, 'Tenant info retrieved successfully', tenant);
});

export const StorefrontController = {
  getStatus,
  getInfo,
  getTheme,
  getProducts,
  getBestsellingProducts,
  getJustForYouProducts,
  getProductBySlug,
  getCategories,
  getBrands,
};
