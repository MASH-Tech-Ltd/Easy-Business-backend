import { Types } from 'mongoose';
import CustomError from '../../helpers/CustomError';
import { normalizeBDPhone } from '../../utils/phoneHelper';
import { BlockedPhone } from './blockedPhone.model';

const blockPhone = async (
  tenantId: string,
  userId: string | undefined,
  payload: { phone: string; customerName?: string; reason?: string }
) => {
  const rawPhone = (payload.phone || '').trim();
  const normalizedPhone = normalizeBDPhone(rawPhone);
  if (!normalizedPhone || normalizedPhone.length < 6) {
    throw new CustomError(400, 'Please provide a valid phone number');
  }

  const updateData: Record<string, any> = {
    tenantId,
    phone: rawPhone,
    normalizedPhone,
    reason: (payload.reason || '').trim() || 'Blocked by merchant',
  };
  if (payload.customerName !== undefined) {
    updateData.customerName = payload.customerName.trim();
  }
  if (userId) {
    updateData.blockedBy = userId;
  }

  return await BlockedPhone.findOneAndUpdate(
    { tenantId, normalizedPhone },
    { $set: updateData },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
};

const unblockPhone = async (tenantId: string, identifier: string) => {
  const decoded = decodeURIComponent(identifier || '').trim();
  if (!decoded) {
    throw new CustomError(400, 'Phone number or ID is required');
  }

  const conditions: any[] = [{ normalizedPhone: normalizeBDPhone(decoded) }, { phone: decoded }];
  if (Types.ObjectId.isValid(decoded)) {
    conditions.push({ _id: decoded });
  }

  const deleted = await BlockedPhone.findOneAndDelete({
    tenantId,
    $or: conditions,
  });

  if (!deleted) {
    throw new CustomError(404, 'Blocked phone number not found');
  }
  return deleted;
};

const getBlockedPhones = async (
  tenantId: string,
  query: { page?: number | string; limit?: number | string; search?: string }
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;
  const search = (query.search || '').trim();

  const filter: any = { tenantId };
  if (search) {
    const normalizedSearch = normalizeBDPhone(search);
    filter.$or = [
      { phone: { $regex: search, $options: 'i' } },
      { normalizedPhone: { $regex: normalizedSearch || search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
      { reason: { $regex: search, $options: 'i' } },
    ];
  }

  const [data, total] = await Promise.all([
    BlockedPhone.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    BlockedPhone.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    data,
  };
};

const isPhoneBlockedForTenant = async (tenantId: string, phone: string): Promise<boolean> => {
  const normalizedPhone = normalizeBDPhone(phone);
  if (!tenantId || !normalizedPhone) return false;
  const found = await BlockedPhone.exists({ tenantId, normalizedPhone });
  return !!found;
};

export const BlockedPhoneService = {
  blockPhone,
  unblockPhone,
  getBlockedPhones,
  isPhoneBlockedForTenant,
};

