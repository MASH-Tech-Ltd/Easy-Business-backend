import { IProduct } from './product.interface';
import { Product } from './product.model';
import { Types } from 'mongoose';
import { paginationHelper } from '../../helpers/paginationHelper';

const createProduct = async (payload: Partial<IProduct>): Promise<IProduct> => {
  const result = await Product.create(payload);
  return result;
};

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

  const sortCondition: any = {};
  if (sortBy) {
    sortCondition[sortBy] = sortOrder === 'asc' ? 1 : -1;
  } else {
    sortCondition['createdAt'] = -1;
  }

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

const updateProduct = async (id: string, payload: Partial<IProduct>): Promise<IProduct | null> => {
  const result = await Product.findByIdAndUpdate(id, payload, { new: true });
  return result;
};

const deleteProduct = async (id: string): Promise<IProduct | null> => {
  const result = await Product.findByIdAndDelete(id);
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
