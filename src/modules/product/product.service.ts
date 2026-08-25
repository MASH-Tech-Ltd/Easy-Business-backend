import { IProduct } from './product.interface';
import { Product } from './product.model';
import { Types } from 'mongoose';
import { paginationHelper } from '../../helpers/paginationHelper';
import CustomError from '../../helpers/CustomError';

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

const getProductsByTenant = async (tenantId: string): Promise<IProduct[]> => {
  const result = await Product.find({ tenantId: new Types.ObjectId(tenantId) }).populate('categoryId');
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
  return result;
};

export const ProductService = {
  createProduct,
  getAllProducts,
  getMyProducts,
  getProductsByTenant,
  getSingleProduct,
  updateProduct,
  deleteProduct,
};
