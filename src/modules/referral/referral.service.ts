import CustomError from '../../helpers/CustomError';
import { paginationHelper } from '../../helpers/paginationHelper';
import { IReferral } from './referral.interface';
import {
  Referral,
  ReferralUsage,
  ReferralReward,
  ReferralWithdrawal,
} from './referral.model';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../auth/auth.model';

/**
 * Validates a referral code for registration or public verification.
 */
const validateCode = async (code: string) => {
  if (!code || typeof code !== 'string') {
    throw new CustomError(400, 'Referral code is required.');
  }

  const cleanCode = code.trim().toUpperCase();
  const referral = await Referral.findOne({ code: cleanCode });

  if (!referral) {
    throw new CustomError(404, 'Invalid referral code. Please check and try again.');
  }

  if (!referral.isActive) {
    throw new CustomError(400, 'This referral code is currently deactivated.');
  }

  if (referral.expiresAt && new Date(referral.expiresAt).getTime() < Date.now()) {
    throw new CustomError(400, 'This referral code has expired.');
  }

  if (typeof referral.maxUses === 'number' && referral.maxUses > 0 && referral.usedCount >= referral.maxUses) {
    throw new CustomError(400, 'This referral code has reached its maximum usage limit.');
  }

  return {
    valid: true,
    code: referral.code,
    offerType: referral.offerType || 'trial_extension',
    extraDays: referral.extraDays ?? 10,
    discountType: referral.discountType || 'percentage',
    discountValue: referral.discountValue || 0,
    description: referral.description || '',
    referrerName: referral.referrerName || '',
    isMerchantCode: referral.isMerchantCode || false,
  };
};

/**
 * Creates a new referral code by super admin.
 */
const createReferral = async (payload: Partial<IReferral>) => {
  if (!payload.code || !payload.code.trim()) {
    throw new CustomError(400, 'Referral code is required.');
  }

  const cleanCode = payload.code.trim().toUpperCase();

  const existing = await Referral.findOne({ code: cleanCode });
  if (existing) {
    throw new CustomError(409, `Referral code "${cleanCode}" already exists.`);
  }

  const extraDays = Number(payload.extraDays) > 0 ? Number(payload.extraDays) : 10;
  const maxUses = payload.maxUses && Number(payload.maxUses) > 0 ? Number(payload.maxUses) : null;
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;

  const referral = new Referral({
    code: cleanCode,
    offerType: payload.offerType || 'trial_extension',
    extraDays,
    discountType: payload.discountType || 'percentage',
    discountValue: Number(payload.discountValue) >= 0 ? Number(payload.discountValue) : 0,
    description: payload.description?.trim() || '',
    referrerName: payload.referrerName?.trim() || '',
    referrerUserId: payload.referrerUserId || null,
    referrerTenantId: payload.referrerTenantId || null,
    isMerchantCode: Boolean(payload.isMerchantCode),
    pointsPerReferral: payload.pointsPerReferral !== undefined ? Number(payload.pointsPerReferral) : 20,
    maxUses,
    usedCount: 0,
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
    expiresAt,
  });

  return await referral.save();
};

/**
 * Super Admin: Get all referrals with pagination, search, and overview statistics.
 */
const getAllReferrals = async (query: any) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, sortBy = 'createdAt', sortOrder = 'desc' } = query;

  const filter: any = {};

  if (search) {
    const searchRegex = { $regex: search.trim(), $options: 'i' };
    filter.$or = [
      { code: searchRegex },
      { referrerName: searchRegex },
      { description: searchRegex },
    ];
  }

  const now = new Date();
  if (status === 'active') {
    filter.isActive = true;
    filter.$or = [
      { expiresAt: null },
      { expiresAt: { $gt: now } },
    ];
  } else if (status === 'inactive') {
    filter.isActive = false;
  } else if (status === 'expired') {
    filter.expiresAt = { $lte: now };
  }

  const sort: any = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const [data, total, statsAggregation] = await Promise.all([
    Referral.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Referral.countDocuments(filter),
    Referral.aggregate([
      {
        $group: {
          _id: null,
          totalCodes: { $sum: 1 },
          activeCodes: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isActive', true] },
                    {
                      $or: [
                        { $eq: ['$expiresAt', null] },
                        { $gt: ['$expiresAt', now] },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalUses: { $sum: '$usedCount' },
          totalDaysGranted: {
            $sum: {
              $multiply: ['$usedCount', '$extraDays'],
            },
          },
        },
      },
    ]),
  ]);

  const stats = statsAggregation[0] || {
    totalCodes: 0,
    activeCodes: 0,
    totalUses: 0,
    totalDaysGranted: 0,
  };

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit) || 1,
    },
    stats,
  };
};

/**
 * Get single referral by ID.
 */
const getReferralById = async (id: string) => {
  const referral = await Referral.findById(id);
  if (!referral) {
    throw new CustomError(404, 'Referral code not found.');
  }
  return referral;
};

/**
 * Update referral details.
 */
const updateReferral = async (id: string, payload: Partial<IReferral>) => {
  const referral = await Referral.findById(id);
  if (!referral) {
    throw new CustomError(404, 'Referral code not found.');
  }

  if (payload.code && payload.code.trim().toUpperCase() !== referral.code) {
    const cleanCode = payload.code.trim().toUpperCase();
    const existing = await Referral.findOne({ code: cleanCode, _id: { $ne: id } });
    if (existing) {
      throw new CustomError(409, `Referral code "${cleanCode}" is already taken.`);
    }
    referral.code = cleanCode;
  }

  if (payload.offerType !== undefined) {
    referral.offerType = payload.offerType as any;
  }
  if (payload.discountType !== undefined) {
    referral.discountType = payload.discountType as any;
  }
  if (payload.discountValue !== undefined) {
    referral.discountValue = Number(payload.discountValue) >= 0 ? Number(payload.discountValue) : 0;
  }
  if (payload.extraDays !== undefined) {
    referral.extraDays = Number(payload.extraDays) >= 0 ? Number(payload.extraDays) : 0;
  }
  if (payload.pointsPerReferral !== undefined) {
    referral.pointsPerReferral = Number(payload.pointsPerReferral) >= 0 ? Number(payload.pointsPerReferral) : 0;
  }
  if (payload.description !== undefined) {
    referral.description = payload.description.trim();
  }
  if (payload.referrerName !== undefined) {
    referral.referrerName = payload.referrerName.trim();
  }
  if (payload.maxUses !== undefined) {
    referral.maxUses = payload.maxUses && Number(payload.maxUses) > 0 ? Number(payload.maxUses) : null;
  }
  if (payload.expiresAt !== undefined) {
    referral.expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  }
  if (payload.isActive !== undefined) {
    referral.isActive = Boolean(payload.isActive);
  }

  return await referral.save();
};

/**
 * Toggle active / inactive status of a referral code.
 */
const toggleStatus = async (id: string) => {
  const referral = await Referral.findById(id);
  if (!referral) {
    throw new CustomError(404, 'Referral code not found.');
  }

  referral.isActive = !referral.isActive;
  return await referral.save();
};

/**
 * Delete a referral code.
 */
const deleteReferral = async (id: string) => {
  const referral = await Referral.findById(id);
  if (!referral) {
    throw new CustomError(404, 'Referral code not found.');
  }

  await Referral.findByIdAndDelete(id);
  return { message: 'Referral code deleted successfully.' };
};

/**
 * Get referral usages/redemptions with pagination and search.
 */
const getReferralUsages = async (query: any) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, referralCode } = query;

  const filter: any = {};
  if (referralCode) {
    filter.referralCode = referralCode.trim().toUpperCase();
  }
  if (search) {
    const searchRegex = { $regex: search.trim(), $options: 'i' };
    filter.$or = [
      { referralCode: searchRegex },
      { referredEmail: searchRegex },
      { referredStoreName: searchRegex },
    ];
  }

  const [data, total] = await Promise.all([
    ReferralUsage.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('referredUserId', 'name email phone')
      .populate('referredTenantId', 'name slug')
      .populate('referrerUserId', 'name email')
      .populate('referrerTenantId', 'name slug')
      .lean(),
    ReferralUsage.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit) || 1,
    },
  };
};

// ============================================================================
// MERCHANT REFERRAL PROGRAM & POINTS SYSTEM
// ============================================================================

/**
 * Get or create a merchant's personal referral code & points wallet.
 */
const getOrCreateMerchantReferral = async (userId: string, tenantId: string) => {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) {
    throw new CustomError(404, 'Store not found.');
  }

  // 1. Check if referral code already exists for this merchant tenant
  let referral = await Referral.findOne({
    referrerTenantId: tenantId,
    isMerchantCode: true,
  });

  if (!referral) {
    // Generate clean unique code based on store name (fallback to slug or SHOP)
    const rawName = (tenant.name || tenant.slug || 'SHOP')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8);
    const cleanPrefix = rawName.length >= 3 ? rawName : 'SHOP';
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const code = `${cleanPrefix}${randomSuffix}`;

    try {
      referral = await Referral.create({
        code,
        offerType: 'trial_extension',
        extraDays: 10,
        description: `Referral code for ${tenant.name}`,
        referrerName: tenant.name,
        referrerUserId: userId,
        referrerTenantId: tenantId,
        isMerchantCode: true,
        pointsPerReferral: 20,
        isActive: true,
        maxUses: null,
      });
    } catch (createErr: any) {
      // If concurrent request created a code at the same millisecond, fetch existing
      referral = await Referral.findOne({
        referrerTenantId: tenantId,
        isMerchantCode: true,
      });
      if (!referral) {
        throw createErr;
      }
    }
  }

  // 2. Get or initialize points reward wallet
  let reward = await ReferralReward.findOne({ tenantId });
  if (!reward) {
    try {
      reward = await ReferralReward.create({
        tenantId,
        userId,
        totalPoints: 0,
        pendingPoints: 0,
        usablePoints: 0,
        withdrawnPoints: 0,
        totalTakaWithdrawn: 0,
      });
    } catch (rewardErr: any) {
      reward = await ReferralReward.findOne({ tenantId });
      if (!reward) throw rewardErr;
    }
  }

  // 3. Get recent referral usages (friends invited)
  const referralsList = await ReferralUsage.find({ referrerTenantId: tenantId })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('referredUserId', 'name email')
    .populate('referredTenantId', 'name slug')
    .lean();

  // 4. Get recent withdrawal requests
  const withdrawals = await ReferralWithdrawal.find({ tenantId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  return {
    referralCode: referral.code,
    referralLink: `/register?ref=${referral.code}`,
    pointsPerReferral: referral.pointsPerReferral || 20,
    extraDaysForFriend: referral.extraDays || 10,
    wallet: {
      usablePoints: reward.usablePoints,
      pendingPoints: reward.pendingPoints,
      totalPoints: reward.totalPoints,
      withdrawnPoints: reward.withdrawnPoints,
      totalTakaWithdrawn: reward.totalTakaWithdrawn,
      usableTaka: reward.usablePoints, // 1 point = 1 Taka
      pendingTaka: reward.pendingPoints,
    },
    referralsList,
    withdrawals,
  };
};

/**
 * Triggered when a tenant purchases/activates a paid subscription.
 * Unlocks pending referral points for the referrer!
 */
const unlockReferralPointsForSubscription = async (referredTenantId: string) => {
  // Find pending referral usages for this referred tenant
  const usages = await ReferralUsage.find({
    referredTenantId,
    pointsStatus: 'pending',
  });

  for (const usage of usages) {
    if (!usage.referrerTenantId) continue;

    // Update usage status to 'usable'
    usage.pointsStatus = 'usable';
    usage.activatedAt = new Date();
    await usage.save();

    // Update referrer's wallet
    const points = usage.pointsAwarded || 20;
    const reward = await ReferralReward.findOne({ tenantId: usage.referrerTenantId });
    if (reward) {
      reward.pendingPoints = Math.max(0, reward.pendingPoints - points);
      reward.usablePoints = (reward.usablePoints || 0) + points;
      await reward.save();
    }
  }
};

/**
 * Merchant requests to convert usable points into Taka (bKash/Nagad/Rocket/Bank).
 */
const requestPointsWithdrawal = async (
  userId: string,
  tenantId: string,
  payload: {
    points: number;
    paymentMethod: 'bKash' | 'Nagad' | 'Rocket' | 'Bank';
    accountNumber: string;
    accountDetails?: string;
  }
) => {
  const points = Number(payload.points);
  if (!points || points < 100) {
    throw new CustomError(400, 'Minimum withdrawal amount is 100 points (৳100).');
  }

  if (!payload.paymentMethod || !payload.accountNumber?.trim()) {
    throw new CustomError(400, 'Please provide payment method and account number.');
  }

  const reward = await ReferralReward.findOne({ tenantId });
  if (!reward || reward.usablePoints < points) {
    throw new CustomError(
      400,
      `Insufficient usable points. You have ${reward?.usablePoints || 0} usable points.`
    );
  }

  // Deduct usable points immediately and hold
  reward.usablePoints -= points;
  await reward.save();

  const withdrawal = new ReferralWithdrawal({
    tenantId,
    userId,
    points,
    takaAmount: points, // 1 point = 1 Taka
    paymentMethod: payload.paymentMethod,
    accountNumber: payload.accountNumber.trim(),
    accountDetails: payload.accountDetails?.trim() || '',
    status: 'pending',
    createdAt: new Date(),
  });

  return await withdrawal.save();
};

/**
 * Super Admin: Get all merchant withdrawal requests with status filter and pagination.
 */
const getAllWithdrawals = async (query: any) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { status, search } = query;

  const filter: any = {};
  if (status && status !== 'all') {
    filter.status = status;
  }

  const [data, total] = await Promise.all([
    ReferralWithdrawal.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email phone')
      .populate('tenantId', 'name slug')
      .lean(),
    ReferralWithdrawal.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit) || 1,
    },
  };
};

/**
 * Super Admin: Approve or Reject points withdrawal request.
 */
const processWithdrawal = async (
  withdrawalId: string,
  status: 'approved' | 'rejected',
  adminFeedback?: string
) => {
  const withdrawal = await ReferralWithdrawal.findById(withdrawalId);
  if (!withdrawal) {
    throw new CustomError(404, 'Withdrawal request not found.');
  }

  if (withdrawal.status !== 'pending') {
    throw new CustomError(400, `This withdrawal has already been ${withdrawal.status}.`);
  }

  const reward = await ReferralReward.findOne({ tenantId: withdrawal.tenantId });

  if (status === 'approved') {
    withdrawal.status = 'approved';
    withdrawal.adminFeedback = adminFeedback || 'Processed successfully';
    withdrawal.processedAt = new Date();

    if (reward) {
      reward.withdrawnPoints += withdrawal.points;
      reward.totalTakaWithdrawn += withdrawal.takaAmount;
      await reward.save();
    }
  } else if (status === 'rejected') {
    withdrawal.status = 'rejected';
    withdrawal.adminFeedback = adminFeedback || 'Request rejected';
    withdrawal.processedAt = new Date();

    // Refund points back to usablePoints
    if (reward) {
      reward.usablePoints += withdrawal.points;
      await reward.save();
    }
  }

  return await withdrawal.save();
};

export const ReferralService = {
  validateCode,
  createReferral,
  getAllReferrals,
  getReferralById,
  updateReferral,
  toggleStatus,
  deleteReferral,
  getReferralUsages,
  // Merchant program & points
  getOrCreateMerchantReferral,
  unlockReferralPointsForSubscription,
  requestPointsWithdrawal,
  getAllWithdrawals,
  processWithdrawal,
};
