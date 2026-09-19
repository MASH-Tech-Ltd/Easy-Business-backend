import { IAddon } from './addon.interface';
import { Addon } from './addon.model';
import CustomError from '../../helpers/CustomError';


const notifyPackageUpdate = async () => {
  try {
    const io = require('../../socket').getIO();
    io.emit('refresh_packages');
  } catch (error) {}
};

const createAddon = async (payload: IAddon): Promise<IAddon> => {
  const isExist = await Addon.findOne({ slug: payload.slug });
  if (isExist) {
    throw new CustomError(400, 'Addon with this slug already exists');
  }
  return await Addon.create(payload);
};

const getAllAddons = async (): Promise<IAddon[]> => {
  return await Addon.find();
};

const getAddonById = async (id: string): Promise<IAddon | null> => {
  return await Addon.findById(id);
};

const updateAddon = async (id: string, payload: Partial<IAddon>): Promise<IAddon> => {
  const addon = await Addon.findByIdAndUpdate(id, payload, { new: true });
  if (!addon) {
    throw new CustomError(404, 'Addon not found');
  }
  await notifyPackageUpdate();
  return addon;
};

const deleteAddon = async (id: string): Promise<void> => {
  const addon = await Addon.findByIdAndDelete(id);
  if (!addon) {
    throw new CustomError(404, 'Addon not found');
  }
};

export const AddonService = {
  createAddon,
  getAllAddons,
  getAddonById,
  updateAddon,
  deleteAddon,
};
