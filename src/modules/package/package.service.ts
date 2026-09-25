import { IPackage } from './package.interface';
import { Package } from './package.model';
import CustomError from '../../helpers/CustomError';
import { paginationHelper } from '../../helpers/paginationHelper';


const notifyPackageUpdate = async () => {
  try {
    const io = require('../../socket').getIO();
    io.emit('refresh_packages');
  } catch (error) {}
};

const createPackage = async (payload: Partial<IPackage>): Promise<IPackage> => {
  if (payload.isPopular && payload.billingCycle) {
    await Package.updateMany(
      { billingCycle: payload.billingCycle, isPopular: true },
      { isPopular: false }
    );
  }
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

/**
 * Public endpoint — no auth required.
 * Returns only active packages sorted by price, for the landing page pricing section.
 */
const getPublicPackages = async (): Promise<IPackage[]> => {
  const result = await Package.find({ isActive: true })
    .sort({ billingCycle: 1, price: 1 })
    .select('name price billingCycle productLimit features tagline description isPopular isRecommended');
  return result;
};

const updatePackage = async (id: string, payload: Partial<IPackage>): Promise<IPackage | null> => {
  const targetPackage = await Package.findById(id);
  if (!targetPackage) {
    throw new CustomError(404, 'Package not found');
  }

  if (payload.isPopular) {
    const billingCycle = payload.billingCycle || targetPackage.billingCycle;
    await Package.updateMany(
      { billingCycle, _id: { $ne: id }, isPopular: true },
      { isPopular: false }
    );
  }

  const result = await Package.findByIdAndUpdate(id, payload, { returnDocument: 'after' });
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
  getPublicPackages,
  updatePackage,
  deletePackage
};
