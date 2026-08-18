import { ICategory } from './category.interface';
import { Category } from './category.model';
import { Product } from '../product/product.model';
import { Types } from 'mongoose';

const createCategory = async (payload: Partial<ICategory>): Promise<ICategory> => {
  const result = await Category.create(payload);
  return result;
};

import { paginationHelper } from '../../helpers/paginationHelper';

const getCategoriesByTenant = async (tenantId: string, query: any = {}): Promise<any> => {
  const { page, limit, skip } = paginationHelper(query.page, query.limit);
  const filter: any = { tenantId: new Types.ObjectId(tenantId) };
  
  if (query.search) {
    filter.name = { $regex: query.search, $options: 'i' };
  }

  const [data, total] = await Promise.all([
    Category.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Category.countDocuments(filter)
  ]);

  const dataWithCounts = await Promise.all(data.map(async (category) => {
    const productCount = await Product.countDocuments({ categoryId: category._id, status: 'ACTIVE' });
    return { ...category, productCount };
  }));

  return {
    data: dataWithCounts,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  };
};

const getAllCategories = async (): Promise<ICategory[]> => {
  const result = await Category.find({});
  return result;
};

const getSingleCategory = async (id: string, tenantId: string): Promise<ICategory | null> => {
  const result = await Category.findOne({ _id: id, tenantId });
  return result;
};

const updateCategory = async (id: string, tenantId: string, payload: Partial<ICategory>): Promise<ICategory | null> => {
  const result = await Category.findOneAndUpdate({ _id: id, tenantId }, payload, { new: true });
  return result;
};

const deleteCategory = async (id: string, tenantId: string): Promise<ICategory | null> => {
  const result = await Category.findOneAndDelete({ _id: id, tenantId });
  return result;
};

export const CategoryService = {
  createCategory,
  getCategoriesByTenant,
  getAllCategories,
  getSingleCategory,
  updateCategory,
  deleteCategory,
};
