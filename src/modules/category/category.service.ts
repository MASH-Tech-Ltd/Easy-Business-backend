import { ICategory } from './category.interface';
import { Category } from './category.model';
import { Product } from '../product/product.model';
import { Types } from 'mongoose';
import CustomError from '../../helpers/CustomError';
import { CacheService } from '../../services/cache/cache.service';
import { CacheKeys } from '../../services/cache/cache.keys';
import { CACHE_TTL } from '../../services/cache/cache.ttl';
import { CacheInvalidation } from '../../services/cache/cache.invalidation';

const handleDuplicateKeyError = (err: any, payload: Partial<ICategory>) => {
  if (err.code === 11000) {
    const keyPattern = err.keyPattern || {};
    if (keyPattern.name) {
      throw new CustomError(400, `A category named "${payload.name || 'this'}" already exists in your store.`);
    }
    if (keyPattern.slug) {
      throw new CustomError(400, `A category with that slug already exists in your store.`);
    }
    throw new CustomError(400, 'A duplicate category already exists in your store.');
  }
  throw err;
};

const createCategory = async (payload: Partial<ICategory>): Promise<ICategory> => {
  try {
    const result = await Category.create(payload);
    if (payload.tenantId) {
      void CacheInvalidation.invalidateCategory(payload.tenantId.toString(), result._id.toString());
    }
    return result;
  } catch (err: any) {
    handleDuplicateKeyError(err, payload);
    throw err;
  }
};

import { paginationHelper } from '../../helpers/paginationHelper';

const getCategoriesByTenant = async (tenantId: string, query: any = {}): Promise<any> => {
  const { page, limit, skip } = paginationHelper(query.page, query.limit);
  const catVer = await CacheService.getVersion(CacheKeys.storeCategoryVersion(tenantId));
  const cacheKey = CacheKeys.storeCategoriesList(tenantId, catVer, {
    page,
    limit,
    search: query.search ? String(query.search).trim().toLowerCase() : undefined,
  });

  const { value } = await CacheService.getOrSet(
    cacheKey,
    async () => {
      const tenantObjId = new Types.ObjectId(tenantId);
      const filter: any = { tenantId: tenantObjId };

      if (query.search) {
        filter.name = { $regex: query.search, $options: 'i' };
      }

      const [data, total] = await Promise.all([
        Category.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Category.countDocuments(filter),
      ]);

      // Single $group aggregation replaces N+1 Product.countDocuments loop
      const categoryIds = data.map((c) => c._id);
      const countMap = new Map<string, number>();
      if (categoryIds.length > 0) {
        const counts = await Product.aggregate([
          {
            $match: {
              tenantId: tenantObjId,
              categoryId: { $in: categoryIds },
              status: 'ACTIVE',
            },
          },
          { $group: { _id: '$categoryId', count: { $sum: 1 } } },
        ]);
        for (const item of counts) {
          if (item._id) countMap.set(String(item._id), item.count);
        }
      }

      const dataWithCounts = data.map((category) => ({
        ...category,
        productCount: countMap.get(String(category._id)) || 0,
      }));

      return {
        data: dataWithCounts,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
    {
      group: 'category',
      ttlSeconds: CACHE_TTL.CATEGORY_COUNTS,
    }
  );

  return value;
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
  try {
    const result = await Category.findOneAndUpdate({ _id: id, tenantId }, payload, { returnDocument: 'after' });
    if (result) {
      void CacheInvalidation.invalidateCategory(tenantId.toString(), id);
      void CacheInvalidation.invalidateMerchantDashboard(tenantId.toString());
    }
    return result;
  } catch (err: any) {
    handleDuplicateKeyError(err, payload);
    throw err;
  }
};

const deleteCategory = async (id: string, tenantId: string): Promise<ICategory | null> => {
  const result = await Category.findOneAndDelete({ _id: id, tenantId });
  if (result) {
    void CacheInvalidation.invalidateCategory(tenantId.toString(), id);
    void CacheInvalidation.invalidateMerchantDashboard(tenantId.toString());
  }
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
