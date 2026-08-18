import { User } from '../auth/auth.model';
import { IUser } from '../auth/auth.interface';

const updateProfile = async (id: string, payload: Partial<IUser>): Promise<IUser | null> => {
  const result = await User.findByIdAndUpdate(id, payload, { new: true });
  return result;
};

const getAllUsers = async (query: any): Promise<IUser[]> => {
  const filter: any = {};
  if (query.role) {
    filter.role = query.role;
  }
  const result = await User.find(filter)
    .populate('tenantId')
    .sort({ createdAt: -1 });
  return result;
};

const getUserById = async (id: string): Promise<IUser | null> => {
  const result = await User.findById(id);
  return result;
};

const updateUser = async (id: string, payload: Partial<IUser>): Promise<IUser | null> => {
  const result = await User.findByIdAndUpdate(id, payload, { new: true });
  return result;
};

const deleteUser = async (id: string): Promise<IUser | null> => {
  const result = await User.findByIdAndDelete(id);
  return result;
};

export const UserService = {
  updateProfile,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
};
