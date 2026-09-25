import { User } from '../auth/auth.model';
import { IUser } from '../auth/auth.interface';

// SECURITY FIX (Mass Assignment): Whitelist only the fields a user can update on their own profile.
// Prevents attackers from sending { "role": "super_admin", "tenantId": "..." } in the request body.
const PROFILE_ALLOWED_FIELDS: (keyof IUser)[] = ['name', 'phone', 'address', 'details', 'avatar'];

const updateProfile = async (id: string, payload: Partial<IUser>): Promise<IUser | null> => {
  // Strip out any fields that are not in the whitelist
  const safePayload: Partial<IUser> = {};
  for (const field of PROFILE_ALLOWED_FIELDS) {
    if (payload[field] !== undefined) {
      (safePayload as any)[field] = payload[field];
    }
  }
  const result = await User.findByIdAndUpdate(id, safePayload, { returnDocument: 'after' });
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

// SECURITY FIX (Mass Assignment): Super admin user update — whitelist safe fields.
// Prevents escalation of privileges via raw body passthrough.
const ADMIN_UPDATE_ALLOWED_FIELDS: (keyof IUser)[] = ['name', 'phone', 'address', 'details', 'role', 'tenantId'];

const updateUser = async (id: string, payload: Partial<IUser>): Promise<IUser | null> => {
  const safePayload: Partial<IUser> = {};
  for (const field of ADMIN_UPDATE_ALLOWED_FIELDS) {
    if (payload[field] !== undefined) {
      (safePayload as any)[field] = payload[field];
    }
  }
  const result = await User.findByIdAndUpdate(id, safePayload, { returnDocument: 'after' });
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
