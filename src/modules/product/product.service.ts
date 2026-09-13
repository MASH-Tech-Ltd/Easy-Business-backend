import { IProduct } from './product.interface';
import { Product } from './product.model';
import { Types } from 'mongoose';
import { paginationHelper } from '../../helpers/paginationHelper';
import CustomError from '../../helpers/CustomError';
import { deleteCloudinary } from '../../helpers/cloudinary';  

// SECURITY: Whitelist of fields allowed for sorting — prevents prototype pollution
const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'title', 'discountedPrice', 'originalPrice', 'stock', 'salesCount'];

const createProduct = async (payload: Partial<IProduct>): Promise<IProduct> => {
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
    { new: true }
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
  const products = await Product.find({ tenantId: new Types.ObjectId(tenantId) });
  if (products.length > 0) {
    const { deleteCloudinary } = require('../../helpers/cloudinary');
    for (const product of products) {
      if (product.images && product.images.length > 0) {
        for (const image of product.images) {
          if (image.public_id) {
            await deleteCloudinary(image.public_id, 'image').catch((err: any) => console.error("Cloudinary delete error:", err));
          }
        }
      }
    }
  }
  
  const result = await Product.deleteMany({ tenantId: new Types.ObjectId(tenantId) });
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
