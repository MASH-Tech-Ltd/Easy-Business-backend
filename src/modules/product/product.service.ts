import { IProduct, ALLOWED_SORT_FIELDS } from './product.interface';
import { Product } from './product.model';
import { Types } from 'mongoose';
import { paginationHelper } from '../../helpers/paginationHelper';
import { Category } from '../category/category.model';
import CustomError from '../../helpers/CustomError';
import { deleteCloudinary } from '../../helpers/cloudinary';
import { Subscription } from '../subscription/subscription.model';  


const createProduct = async (payload: Partial<IProduct>): Promise<IProduct> => {
  const { tenantId } = payload;
  if (!tenantId) {
    throw new CustomError(400, 'tenantId is required to create a product');
  }

  // Find the active subscription
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('packageId');
  if (!subscription) {
    throw new CustomError(403, 'No active subscription found. Please subscribe to a plan to continue.');
  }

  // If packageId is null, it represents the Free Tier which has a limit of 20 products
  const productLimit = subscription.packageId ? (subscription.packageId as any).productLimit : 20;

  // Check current product count
  const currentProductCount = await Product.countDocuments({ tenantId });
  if (currentProductCount >= productLimit) {
    throw new CustomError(403, `Product limit reached. Your current plan allows up to ${productLimit} products. Please upgrade to add more.`);
  }

  const result = await Product.create(payload);
  return result;
};

// SECURITY FIX: getAllProducts is now scoped to super_admin use only (called from its controller with proper guard)
const getAllProducts = async (): Promise<IProduct[]> => {
  const result = await Product.find({});
  return result;
};

const getMyProducts = async (tenantId: string, query: any): Promise<{ data: IProduct[], meta: any }> => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, sortBy, sortOrder, categoryId, status } = query;

  const filter: any = { tenantId: new Types.ObjectId(tenantId) };
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { shortDescription: { $regex: search, $options: 'i' } },
    ];
  }

  if (categoryId && categoryId !== 'all') {
    filter.categoryId = new Types.ObjectId(categoryId);
  }

  if (status) {
    filter.status = status;
  }

  // SECURITY FIX: Whitelist sortBy to prevent prototype pollution / NoSQL injection
  const sortCondition: any = {};
  const safeSortBy = ALLOWED_SORT_FIELDS.includes(sortBy) ? sortBy : 'createdAt';
  sortCondition[safeSortBy] = sortOrder === 'asc' ? 1 : -1;

  const [data, total] = await Promise.all([
    Product.find(filter)
      .populate('categoryId')
      .sort(sortCondition)
      .skip(skip)
      .limit(limit),
    Product.countDocuments(filter)
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  };
};

const getProductsByTenant = async (tenantId: string, query: any): Promise<{ data: IProduct[], meta: any }> => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, sortBy, sortOrder, categoryId } = query;

  const filter: any = { tenantId: new Types.ObjectId(tenantId), status: 'ACTIVE' };
  
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { shortDescription: { $regex: search, $options: 'i' } },
    ];
  }

  if (categoryId && categoryId !== 'all') {
    filter.categoryId = new Types.ObjectId(categoryId);
  }

  const sortCondition: any = {};
  const safeSortBy = ALLOWED_SORT_FIELDS.includes(sortBy) ? sortBy : 'createdAt';
  sortCondition[safeSortBy] = sortOrder === 'asc' ? 1 : -1;

  const [data, total] = await Promise.all([
    Product.find(filter)
      .populate('categoryId')
      .sort(sortCondition)
      .skip(skip)
      .limit(limit),
    Product.countDocuments(filter)
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  };
};

const getBestsellingProducts = async (tenantId: string, limit: number = 8): Promise<IProduct[]> => {
  const result = await Product.find({ 
    tenantId: new Types.ObjectId(tenantId), 
    status: 'ACTIVE' 
  })
    .populate('categoryId')
    .sort({ salesCount: -1 })
    .limit(limit);
  return result;
};

const getSingleProduct = async (id: string): Promise<IProduct | null> => {
  const result = await Product.findById(id).populate('categoryId');
  return result;
};

// SECURITY FIX (IDOR): Always scope update to the caller's tenantId — prevents cross-tenant manipulation
const updateProduct = async (id: string, tenantId: string, payload: Partial<IProduct>): Promise<IProduct | null> => {
  const result = await Product.findOneAndUpdate(
    { _id: id, tenantId: new Types.ObjectId(tenantId) },
    payload,
    { returnDocument: 'after' }
  );
  if (!result) {
    throw new CustomError(404, 'Product not found or you do not have permission to update it');
  }
  return result;
};

// SECURITY FIX (IDOR): Always scope delete to the caller's tenantId — prevents cross-tenant deletion
const deleteProduct = async (id: string, tenantId: string): Promise<IProduct | null> => {
  const result = await Product.findOneAndDelete({ _id: id, tenantId: new Types.ObjectId(tenantId) });
  if (!result) {
    throw new CustomError(404, 'Product not found or you do not have permission to delete it');
  }
  
  if (result.images && result.images.length > 0) {
    for (const image of result.images) {
      if (image.public_id) {
        await deleteCloudinary(image.public_id, 'image').catch((err: any) => console.error("Cloudinary delete error:", err));
      }
    }
  }
  
  return result;
};

// FEATURE: Delete all products by tenant (for super admin)
const deleteAllProductsByTenant = async (tenantId: string): Promise<any> => {
  // Use lean() and select() to prevent Out of Memory (OOM) on large catalogs
  const products = await Product.find({ tenantId: new Types.ObjectId(tenantId) }).select('images').lean();
  const categories = await Category.find({ tenantId: new Types.ObjectId(tenantId) }).select('image').lean();
  
  // Delete products and categories from database immediately to prevent API timeout
  const result = await Product.deleteMany({ tenantId: new Types.ObjectId(tenantId) });
  await Category.deleteMany({ tenantId: new Types.ObjectId(tenantId) });
  
  // Delete images from Cloudinary in the background
  if (products.length > 0 || categories.length > 0) {

    
    // Background task (IIFE)
    (async () => {
      for (const product of products) {
        if (product.images && product.images.length > 0) {
          for (const image of product.images) {
            if (image.public_id) {
              await deleteCloudinary(image.public_id, 'image').catch((err: any) => console.error("Cloudinary delete error:", err));
            }
          }
        }
      }
      for (const category of categories as any[]) {
        if (category.image && category.image.public_id) {
          await deleteCloudinary(category.image.public_id, 'image').catch((err: any) => console.error("Cloudinary delete error:", err));
        }
      }
    })();
  }
  
  return result;
};

export const ProductService = {
  createProduct,
  getAllProducts,
  getMyProducts,
  getProductsByTenant,
  getBestsellingProducts,
  getSingleProduct,
  updateProduct,
  deleteProduct,
  deleteAllProductsByTenant,
};
