import { IPackage } from './package.interface';
import { Package } from './package.model';
import CustomError from '../../helpers/CustomError';
import { paginationHelper } from '../../helpers/paginationHelper';

const createPackage = async (payload: Partial<IPackage>): Promise<IPackage> => {
  const result = await Package.create(payload);
  return result;
};

const getAllPackages = async (page?: string | number, limit?: string | number): Promise<{ data: IPackage[]; meta: any }> => {
  const { page: currentPage, limit: perPage, skip } = paginationHelper(page, limit);

  const total = await Package.countDocuments();
  const result = await Package.find().sort({ billingCycle: 1, price: 1 }).skip(skip).limit(perPage);
  
  return {
    data: result,
    meta: {
      page: currentPage,
      limit: perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    }
  };
};

const updatePackage = async (id: string, payload: Partial<IPackage>): Promise<IPackage | null> => {
  const result = await Package.findByIdAndUpdate(id, payload, { new: true });
  if (!result) {
    throw new CustomError(404, 'Package not found');
  }
  return result;
};

const deletePackage = async (id: string): Promise<IPackage | null> => {
  const result = await Package.findByIdAndDelete(id);
  if (!result) {
    throw new CustomError(404, 'Package not found');
  }
  return result;
};

export const PackageService = {
  createPackage,
  getAllPackages,
  updatePackage,
  deletePackage
};
