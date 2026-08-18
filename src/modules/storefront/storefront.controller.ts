import { Request, Response } from 'express';
import { Tenant } from '../tenant/tenant.model';
import { Product } from '../product/product.model';
import { Category } from '../category/category.model';
import { Theme } from '../theme/theme.model';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

// Utility to resolve tenantId from slug
const resolveTenant = async (slug: string) => {
  const tenant = await Tenant.findOne({ slug, status: 'active' });
  if (!tenant) throw new Error('Tenant not found');
  return tenant._id;
};

const getTheme = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const tenantId = await resolveTenant(tenantSlug);
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
  
  const { limit, page, categoryId, search, minPrice, maxPrice, inStock, sort, brand } = req.query;
  
  const query: any = { tenantId, status: 'ACTIVE' };
  
  if (categoryId) {
    query.categoryId = categoryId;
  }
  
  if (search) {
    query.title = { $regex: search, $options: 'i' };
  }
  
  if (brand) {
    query.brand = { $regex: brand, $options: 'i' };
  }
  
  if (inStock === 'true') {
    query.stock = { $gt: 0 };
  }
  
  if (minPrice !== undefined || maxPrice !== undefined) {
    query.discountedPrice = {};
    if (minPrice !== undefined) query.discountedPrice.$gte = Number(minPrice);
    if (maxPrice !== undefined) query.discountedPrice.$lte = Number(maxPrice);
  }
  
  let productsQuery = Product.find(query).populate('categoryId');
  
  if (sort) {
    if (sort === 'price_asc') {
      productsQuery = productsQuery.sort({ discountedPrice: 1 });
    } else if (sort === 'price_desc') {
      productsQuery = productsQuery.sort({ discountedPrice: -1 });
    } else if (sort === 'newest') {
      productsQuery = productsQuery.sort({ createdAt: -1 });
    } else if (sort === 'discount_desc') {
      productsQuery = productsQuery.sort({ saveAmount: -1 });
    } else if (sort === 'brand') {
      productsQuery = productsQuery.sort({ brand: 1 });
    } else {
      productsQuery = productsQuery.sort({ createdAt: -1 });
    }
  } else {
    productsQuery = productsQuery.sort({ createdAt: -1 });
  }
  
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 20; // Changed default from 50 to 20 based on user request
  const skip = (pageNum - 1) * limitNum;

  productsQuery = productsQuery.skip(skip).limit(limitNum);
  
  const [products, total] = await Promise.all([
    productsQuery,
    Product.countDocuments(query)
  ]);
  
  ApiResponse.sendSuccess(res, 200, 'Products retrieved successfully', {
    data: products,
    pagination: {
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    }
  });
});

const getProductBySlug = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const slug = req.params.slug as string;
  const tenantId = await resolveTenant(tenantSlug);
  
  const product = await Product.findOne({ tenantId, slug, status: 'ACTIVE' }).populate('categoryId');
  if (!product) {
    return ApiResponse.sendError(res, 404, 'Product not found');
  }
  ApiResponse.sendSuccess(res, 200, 'Product retrieved successfully', product);
});

const getCategories = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const tenantId = await resolveTenant(tenantSlug);
  
  const categories = await Category.find({ tenantId });
  ApiResponse.sendSuccess(res, 200, 'Categories retrieved successfully', categories);
});

const getBrands = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const categoryId = req.query.categoryId as string;
  const tenantId = await resolveTenant(tenantSlug);
  
  const query: any = { tenantId, status: 'ACTIVE', brand: { $nin: [null, ''] } };
  if (categoryId) {
    query.categoryId = categoryId;
  }
  
  const brands = await Product.distinct('brand', query);
  
  // Sort alphabetically
  brands.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  
  ApiResponse.sendSuccess(res, 200, 'Brands retrieved successfully', brands);
});

const getInfo = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;
  const tenant = await Tenant.findOne({ slug: tenantSlug, status: 'active' }).select('name logo slug domain settings');
  
  if (!tenant) {
    return ApiResponse.sendError(res, 404, 'Tenant not found');
  }
  
  ApiResponse.sendSuccess(res, 200, 'Tenant info retrieved successfully', tenant);
});

export const StorefrontController = {
  getInfo,
  getTheme,
  getProducts,
  getProductBySlug,
  getCategories,
  getBrands,
};
