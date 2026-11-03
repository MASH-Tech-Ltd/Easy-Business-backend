import mongoose, { Types } from 'mongoose';
import CustomError from '../../../helpers/CustomError';
import { paginationHelper } from '../../../helpers/paginationHelper';
import {
  Affiliate,
  AffiliateReferral,
  AffiliateCommission,
  AffiliateWithdrawal,
  AffiliateLedger,
  AffiliateAuditLog,
} from '../affiliate.model';
import { User } from '../../auth/auth.model';
import { AffiliateBalanceService } from './balance.service';
import { AffiliateCommissionService } from './commission.service';
import {
  round2,
  getAffiliateGlobalConfig,
  recordAffiliateAuditLog,
  emitAffiliateSocketEvent,
} from '../affiliate.utils';
import { AFFILIATE_SOCKET_EVENTS } from '../affiliate.constants';
import { notificationService } from '../../notification/notification.service';

/**
 * Section 10.1: Returns all 10 Admin Affiliate Overview Cards + Program Capacity metrics.
 */
const getAdminOverviewStats = async () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalAffiliates,
    activeAffiliates,
    suspendedAffiliates,
    pendingAffiliates,
    newAffiliatesThisMonth,
    totalReferredMerchants,
    subscribedReferredMerchants,
    financialTotals,
    pendingWithdrawalsCount,
    completedWithdrawalsAgg,
    globalConfig,
  ] = await Promise.all([
    Affiliate.countDocuments(),
    Affiliate.countDocuments({ status: 'active' }),
    Affiliate.countDocuments({ status: { $in: ['suspended', 'deactivated'] } }),
    Affiliate.countDocuments({ status: 'pending' }),
    Affiliate.countDocuments({ createdAt: { $gte: startOfMonth } }),
    AffiliateReferral.countDocuments(),
    AffiliateReferral.countDocuments({
      $or: [{ paymentsCount: { $gt: 0 } }, { subscriptionStatus: 'active' }],
    }),
    Affiliate.aggregate([
      {
        $group: {
          _id: null,
          totalCommissionGenerated: { $sum: '$totalEarnings' },
          totalAvailableBalance: { $sum: '$availableBalance' },
          totalPendingCommission: { $sum: '$pendingBalance' },
          totalReservedBalance: { $sum: '$reservedBalance' },
          totalCommissionPaid: { $sum: '$totalWithdrawn' },
        },
      },
    ]),
    AffiliateWithdrawal.countDocuments({ status: { $in: ['pending', 'processing'] } }),
    AffiliateWithdrawal.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: null,
          totalWithdrawalsCount: { $sum: 1 },
          totalWithdrawnAmount: { $sum: '$amount' },
        },
      },
    ]),
    getAffiliateGlobalConfig(),
  ]);

  const fin = financialTotals[0] || {};
  const compW = completedWithdrawalsAgg[0] || {};

  return {
    totalAffiliates,
    activeAffiliates,
    suspendedAffiliates,
    pendingAffiliates,
    newAffiliatesThisMonth,
    totalReferredMerchants,
    subscribedReferredMerchants,
    totalCommissionGenerated: round2(fin.totalCommissionGenerated || 0),
    totalCommissionPaid: round2(fin.totalCommissionPaid || 0),
    pendingCommission: round2(fin.totalPendingCommission || 0),
    availableCommissionBalance: round2(fin.totalAvailableBalance || 0),
    reservedWithdrawalBalance: round2(fin.totalReservedBalance || 0),
    pendingWithdrawalRequests: pendingWithdrawalsCount,
    totalAffiliateWithdrawals: round2(compW.totalWithdrawnAmount || fin.totalCommissionPaid || 0),
    totalCompletedWithdrawalsCount: compW.totalWithdrawalsCount || 0,
    maxAffiliates: Number(globalConfig.maxAffiliates ?? 500),
    allowAffiliateRegistration: Boolean(globalConfig.allowAffiliateRegistration),
    programEnabled: Boolean(globalConfig.programEnabled),
  };
};

/**
 * Section 10.2: Paginated Affiliates Management Table with search, status filter, and sorting.
 */
const getAdminAffiliatesList = async (query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, sortBy = 'newest' } = query;

  const filter: any = {};
  if (status && status !== 'all') {
    filter.status = status;
  }

  if (search && typeof search === 'string' && search.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' };
    const matchingUsers = await User.find({
      role: 'affiliate_partner',
      $or: [{ name: regex }, { email: regex }, { phone: regex }],
    })
      .select('_id')
      .lean();
    const userIds = matchingUsers.map((u) => u._id);

    filter.$or = [{ affiliateCode: regex }, { userId: { $in: userIds } }];
  }

  let sortCriteria: any = { createdAt: -1 };
  if (sortBy === 'oldest') sortCriteria = { createdAt: 1 };
  else if (sortBy === 'earnings_desc') sortCriteria = { totalEarnings: -1 };
  else if (sortBy === 'referrals_desc') sortCriteria = { totalReferrals: -1 };
  else if (sortBy === 'balance_desc') sortCriteria = { availableBalance: -1 };

  const [affiliates, total] = await Promise.all([
    Affiliate.find(filter)
      .populate('userId', 'name email phone address createdAt')
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean(),
    Affiliate.countDocuments(filter),
  ]);

  const data = affiliates.map((aff: any) => ({
    ...aff,
    totalEarnings: round2(aff.totalEarnings),
    availableBalance: round2(aff.availableBalance),
    pendingBalance: round2(aff.pendingBalance),
    reservedBalance: round2(aff.reservedBalance),
    totalWithdrawn: round2(aff.totalWithdrawn),
  }));

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

/**
 * Section 10.2: Detailed Affiliate Partner view for Admin (`/affiliates/:id`).
 */
const getAdminAffiliateDetail = async (affiliateId: string, query: any = {}) => {
  if (!Types.ObjectId.isValid(affiliateId)) {
    throw new CustomError(400, 'Invalid affiliate ID');
  }

  const affObjId = new Types.ObjectId(affiliateId);
  const affiliate = await Affiliate.findById(affObjId)
    .populate('userId', 'name email phone address createdAt')
    .lean();

  if (!affiliate) {
    throw new CustomError(404, 'Affiliate partner not found');
  }

  const refPage = paginationHelper(query?.refPage || 1, query?.refLimit || 10);
  const commPage = paginationHelper(query?.commPage || 1, query?.commLimit || 10);
  const wdPage = paginationHelper(query?.wdPage || 1, query?.wdLimit || 10);

  const [
    referrals,
    referralsTotal,
    commissions,
    commissionsTotal,
    withdrawals,
    withdrawalsTotal,
    ledger,
    auditLogs,
  ] = await Promise.all([
    AffiliateReferral.find({ affiliateId: affObjId })
      .populate('referredTenantId', 'name slug domain customDomain status')
      .sort({ registeredAt: -1 })
      .skip(refPage.skip)
      .limit(refPage.limit)
      .lean(),
    AffiliateReferral.countDocuments({ affiliateId: affObjId }),
    AffiliateCommission.find({ affiliateId: affObjId })
      .sort({ createdAt: -1 })
      .skip(commPage.skip)
      .limit(commPage.limit)
      .lean(),
    AffiliateCommission.countDocuments({ affiliateId: affObjId }),
    AffiliateWithdrawal.find({ affiliateId: affObjId })
      .sort({ requestedAt: -1 })
      .skip(wdPage.skip)
      .limit(wdPage.limit)
      .lean(),
    AffiliateWithdrawal.countDocuments({ affiliateId: affObjId }),
    AffiliateLedger.find({ affiliateId: affObjId }).sort({ createdAt: -1 }).limit(25).lean(),
    AffiliateAuditLog.find({ targetId: affiliateId }).sort({ createdAt: -1 }).limit(25).lean(),
  ]);

  return {
    affiliate: {
      ...affiliate,
      totalEarnings: round2((affiliate as any).totalEarnings),
      availableBalance: round2((affiliate as any).availableBalance),
      pendingBalance: round2((affiliate as any).pendingBalance),
      reservedBalance: round2((affiliate as any).reservedBalance),
      totalWithdrawn: round2((affiliate as any).totalWithdrawn),
    },
    referrals: {
      data: referrals,
      meta: {
        page: refPage.page,
        limit: refPage.limit,
        total: referralsTotal,
        totalPages: Math.ceil(referralsTotal / refPage.limit) || 1,
      },
    },
    commissions: {
      data: commissions,
      meta: {
        page: commPage.page,
        limit: commPage.limit,
        total: commissionsTotal,
        totalPages: Math.ceil(commissionsTotal / commPage.limit) || 1,
      },
    },
    withdrawals: {
      data: withdrawals,
      meta: {
        page: wdPage.page,
        limit: wdPage.limit,
        total: withdrawalsTotal,
        totalPages: Math.ceil(withdrawalsTotal / wdPage.limit) || 1,
      },
    },
    ledger,
    auditLogs,
  };
};

/**
 * Admin: Activate, Suspend, or Deactivate an Affiliate Partner account, or override commission config.
 */
const updateAffiliateStatus = async (params: {
  affiliateId: string;
  status: 'active' | 'pending' | 'suspended' | 'deactivated';
  reason?: string | undefined;
  commissionConfigOverride?: {
    commissionRate?: number | undefined;
    durationMonths?: number | undefined;
    commissionType?: 'recurring' | 'one_time' | undefined;
  } | undefined;
  adminActorId: string | Types.ObjectId;
  ipAddress?: string | undefined;
}) => {
  const affiliate = await Affiliate.findById(params.affiliateId);
  if (!affiliate) throw new CustomError(404, 'Affiliate partner not found');

  const previousStatus = affiliate.status;
  affiliate.status = params.status;
  if (params.status === 'suspended' || params.status === 'deactivated') {
    affiliate.suspensionReason = params.reason || 'Action taken by administrator';
  } else if (params.status === 'active') {
    affiliate.suspensionReason = '';
    if (!affiliate.approvedAt) {
      affiliate.approvedAt = new Date();
      affiliate.approvedBy = new Types.ObjectId(params.adminActorId.toString());
    }
  }

  if (params.commissionConfigOverride) {
    affiliate.commissionConfigOverride = {
      ...(affiliate.commissionConfigOverride || {}),
      ...params.commissionConfigOverride,
    };
  }

  await affiliate.save();

  await recordAffiliateAuditLog({
    actorId: params.adminActorId,
    actorRole: 'super_admin',
    action: `AFFILIATE_STATUS_${params.status.toUpperCase()}`,
    targetType: 'affiliate',
    targetId: affiliate._id.toString(),
    reason: params.reason,
    ipAddress: params.ipAddress,
    metadata: {
      previousStatus,
      newStatus: params.status,
      commissionConfigOverride: affiliate.commissionConfigOverride,
    },
  });

  emitAffiliateSocketEvent(
    `affiliate_${affiliate._id.toString()}`,
    AFFILIATE_SOCKET_EVENTS.ACCOUNT_STATUS_CHANGED,
    {
      affiliateId: affiliate._id.toString(),
      status: affiliate.status,
      reason: affiliate.suspensionReason,
    }
  );

  emitAffiliateSocketEvent('admin_affiliates', AFFILIATE_SOCKET_EVENTS.ADMIN_STATS_UPDATED, {
    affiliateId: affiliate._id.toString(),
    status: affiliate.status,
  });

  await notificationService.createNotification(
    affiliate.userId,
    'AFFILIATE_STATUS_CHANGED',
    `Account Status Updated: ${params.status.toUpperCase()}`,
    params.status === 'active'
      ? 'Your Affiliate Partner account is now active!'
      : `Your Affiliate Partner account status was changed to ${params.status}.${
          params.reason ? ` Reason: ${params.reason}` : ''
        }`,
    affiliate._id
  );

  return affiliate;
};

/**
 * Admin: Global paginated Commissions list with filters.
 */
const getAdminCommissionsList = async (query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, affiliateId, sortBy = 'newest' } = query;

  const filter: any = {};
  if (status && status !== 'all') filter.status = status;
  if (affiliateId && Types.ObjectId.isValid(affiliateId)) {
    filter.affiliateId = new Types.ObjectId(affiliateId);
  }

  if (search && typeof search === 'string' && search.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' };
    filter.$or = [
      { referredStoreName: regex },
      { referredMerchantName: regex },
      { paymentDescription: regex },
    ];
  }

  let sortCriteria: any = { createdAt: -1 };
  if (sortBy === 'oldest') sortCriteria = { createdAt: 1 };
  else if (sortBy === 'amount_desc') sortCriteria = { commissionAmount: -1 };

  const [data, total] = await Promise.all([
    AffiliateCommission.find(filter)
      .populate({
        path: 'affiliateId',
        select: 'affiliateCode status userId',
        populate: { path: 'userId', select: 'name email phone' },
      })
      .populate('referredTenantId', 'name slug domain customDomain')
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean(),
    AffiliateCommission.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

/**
 * Admin: Approve/Settle a pending commission to available, or reverse/reject a commission.
 */
const updateCommissionStatus = async (params: {
  commissionId: string;
  status: 'approved' | 'available' | 'rejected' | 'reversed';
  reason?: string | undefined;
  adminActorId: string | Types.ObjectId;
  ipAddress?: string | undefined;
}) => {
  const commission = await AffiliateCommission.findById(params.commissionId);
  if (!commission) throw new CustomError(404, 'Commission record not found');

  if (params.status === 'reversed' || params.status === 'rejected') {
    return AffiliateCommissionService.reverseCommission({
      commissionId: commission._id,
      reason: params.reason || `Commission ${params.status} by administrator`,
      actorId: params.adminActorId,
    });
  }

  if (commission.status === 'available' || commission.status === 'paid') {
    throw new CustomError(400, 'This commission is already settled and available.');
  }

  if (commission.status !== 'pending') {
    throw new CustomError(400, `Cannot approve commission from status "${commission.status}".`);
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    commission.status = 'available';
    commission.approvedAt = new Date();
    commission.settledAt = new Date();
    commission.adminActorId = new Types.ObjectId(params.adminActorId.toString());
    await commission.save({ session });

    await AffiliateBalanceService.settlePendingCommissionToAvailable({
      affiliateId: commission.affiliateId,
      commissionId: commission._id,
      amount: commission.commissionAmount,
      description: `Commission approved & settled (৳${commission.commissionAmount}) from ${commission.referredStoreName}`,
      actorId: params.adminActorId,
      session,
    });

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }

  await recordAffiliateAuditLog({
    actorId: params.adminActorId,
    actorRole: 'super_admin',
    action: 'COMMISSION_APPROVED',
    targetType: 'commission',
    targetId: commission._id.toString(),
    reason: params.reason,
    ipAddress: params.ipAddress,
    metadata: {
      commissionAmount: commission.commissionAmount,
      affiliateId: commission.affiliateId.toString(),
    },
  });

  emitAffiliateSocketEvent(
    `affiliate_${commission.affiliateId.toString()}`,
    AFFILIATE_SOCKET_EVENTS.COMMISSION_APPROVED,
    {
      commissionId: commission._id.toString(),
      amount: commission.commissionAmount,
    }
  );

  await notificationService.createNotification(
    commission.affiliateUserId,
    'AFFILIATE_COMMISSION_APPROVED',
    'Commission Approved',
    `Your commission of ৳${commission.commissionAmount} from "${commission.referredStoreName}" has been approved and added to your available balance.`,
    commission._id
  );

  return commission;
};

/**
 * Section 10.3: Admin Paginated Withdrawals List with filters.
 */
const getAdminWithdrawalsList = async (query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, paymentMethod, sortBy = 'newest' } = query;

  const filter: any = {};
  if (status && status !== 'all') filter.status = status;
  if (paymentMethod && paymentMethod !== 'all') filter.paymentMethod = paymentMethod;

  if (search && typeof search === 'string' && search.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' };
    const matchingUsers = await User.find({
      role: 'affiliate_partner',
      $or: [{ name: regex }, { email: regex }, { phone: regex }],
    })
      .select('_id')
      .lean();
    const userIds = matchingUsers.map((u) => u._id);

    filter.$or = [
      { 'paymentDetails.accountNumber': regex },
      { 'paymentDetails.accountName': regex },
      { transactionReference: regex },
      { userId: { $in: userIds } },
    ];
  }

  let sortCriteria: any = { requestedAt: -1 };
  if (sortBy === 'oldest') sortCriteria = { requestedAt: 1 };
  else if (sortBy === 'amount_desc') sortCriteria = { amount: -1 };

  const [data, total] = await Promise.all([
    AffiliateWithdrawal.find(filter)
      .populate('affiliateId', 'affiliateCode availableBalance reservedBalance totalWithdrawn status')
      .populate('userId', 'name email phone')
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean(),
    AffiliateWithdrawal.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

/**
 * Section 10.3: Admin processes an Affiliate Withdrawal request (`processing` | `completed` | `rejected`).
 * Enforces strict state machine transitions and atomic balance settlement/release.
 */
const processAffiliateWithdrawal = async (params: {
  withdrawalId: string;
  status: 'processing' | 'completed' | 'rejected';
  transactionReference?: string | undefined;
  rejectionReason?: string | undefined;
  adminNotes?: string | undefined;
  adminActorId: string | Types.ObjectId;
  ipAddress?: string | undefined;
}) => {
  const withdrawal = await AffiliateWithdrawal.findById(params.withdrawalId);
  if (!withdrawal) throw new CustomError(404, 'Withdrawal request not found');

  if (withdrawal.status === 'completed' || withdrawal.status === 'rejected') {
    throw new CustomError(
      400,
      `This withdrawal has already been finalized as "${withdrawal.status}" and cannot be modified.`
    );
  }

  if (params.status === 'rejected' && (!params.rejectionReason || !params.rejectionReason.trim())) {
    throw new CustomError(400, 'Please provide a rejection reason when rejecting a withdrawal.');
  }

  const globalConfig = await getAffiliateGlobalConfig();

  if (params.status === 'processing') {
    withdrawal.status = 'processing';
    withdrawal.processingAt = new Date();
    if (params.adminNotes) withdrawal.adminNotes = params.adminNotes;
    if (params.transactionReference) withdrawal.transactionReference = params.transactionReference;
    withdrawal.adminActorId = new Types.ObjectId(params.adminActorId.toString());
    await withdrawal.save();

    await recordAffiliateAuditLog({
      actorId: params.adminActorId,
      actorRole: 'super_admin',
      action: 'WITHDRAWAL_MARKED_PROCESSING',
      targetType: 'withdrawal',
      targetId: withdrawal._id.toString(),
      ipAddress: params.ipAddress,
      metadata: { amount: withdrawal.amount },
    });

    emitAffiliateSocketEvent(
      `affiliate_${withdrawal.affiliateId.toString()}`,
      AFFILIATE_SOCKET_EVENTS.WITHDRAWAL_PROCESSING,
      { withdrawal }
    );

    return withdrawal;
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    withdrawal.status = params.status;
    withdrawal.adminActorId = new Types.ObjectId(params.adminActorId.toString());
    if (params.adminNotes) withdrawal.adminNotes = params.adminNotes;

    if (params.status === 'completed') {
      withdrawal.completedAt = new Date();
      withdrawal.transactionReference =
        params.transactionReference?.trim() || `TRX-${Date.now().toString(36).toUpperCase()}`;

      await AffiliateBalanceService.completeReservedWithdrawal({
        affiliateId: withdrawal.affiliateId,
        withdrawalId: withdrawal._id,
        amount: withdrawal.amount,
        description: `Withdrawal completed (৳${withdrawal.amount}) via ${withdrawal.paymentMethod} — Ref: ${withdrawal.transactionReference}`,
        actorId: params.adminActorId,
        session,
      });
    } else if (params.status === 'rejected') {
      withdrawal.rejectedAt = new Date();
      withdrawal.rejectionReason = params.rejectionReason!.trim();

      await AffiliateBalanceService.releaseRejectedWithdrawal({
        affiliateId: withdrawal.affiliateId,
        withdrawalId: withdrawal._id,
        amount: withdrawal.amount,
        description: `Withdrawal rejected & returned to available balance (৳${withdrawal.amount}): ${withdrawal.rejectionReason}`,
        actorId: params.adminActorId,
        session,
      });
    }

    await withdrawal.save({ session });
    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }

  await recordAffiliateAuditLog({
    actorId: params.adminActorId,
    actorRole: 'super_admin',
    action:
      params.status === 'completed' ? 'WITHDRAWAL_COMPLETED' : 'WITHDRAWAL_REJECTED',
    targetType: 'withdrawal',
    targetId: withdrawal._id.toString(),
    reason: params.rejectionReason || params.adminNotes,
    ipAddress: params.ipAddress,
    metadata: {
      amount: withdrawal.amount,
      paymentMethod: withdrawal.paymentMethod,
      transactionReference: withdrawal.transactionReference,
    },
  });

  emitAffiliateSocketEvent(
    `affiliate_${withdrawal.affiliateId.toString()}`,
    params.status === 'completed'
      ? AFFILIATE_SOCKET_EVENTS.WITHDRAWAL_COMPLETED
      : AFFILIATE_SOCKET_EVENTS.WITHDRAWAL_REJECTED,
    { withdrawal }
  );

  emitAffiliateSocketEvent('admin_affiliates', AFFILIATE_SOCKET_EVENTS.ADMIN_STATS_UPDATED, {
    withdrawalId: withdrawal._id.toString(),
    status: withdrawal.status,
  });

  if (params.status === 'completed' && globalConfig.notifications?.onWithdrawalCompleted !== false) {
    await notificationService.createNotification(
      withdrawal.userId,
      'AFFILIATE_WITHDRAWAL_COMPLETED',
      'Withdrawal Completed',
      `Your withdrawal of ৳${withdrawal.amount} via ${withdrawal.paymentMethod} has been paid (Ref: ${withdrawal.transactionReference}).`,
      withdrawal._id
    );
  } else if (
    params.status === 'rejected' &&
    globalConfig.notifications?.onWithdrawalRejected !== false
  ) {
    await notificationService.createNotification(
      withdrawal.userId,
      'AFFILIATE_WITHDRAWAL_REJECTED',
      'Withdrawal Request Rejected',
      `Your withdrawal request of ৳${withdrawal.amount} was rejected and ৳${withdrawal.amount} has been returned to your available balance. Reason: ${withdrawal.rejectionReason}`,
      withdrawal._id
    );
  }

  return withdrawal;
};

/**
 * Admin: Paginated Affiliate Audit Logs (auto-purged after 24h via TTL).
 */
const getAdminAuditLogs = async (query: any = {}) => {
  const page = Math.max(1, Number(query?.page) || 1);
  const limit = Number(query?.limit) > 0 ? Number(query?.limit) : 20;
  const skip = (page - 1) * limit;
  const { targetType, action, search } = query;

  const filter: any = {};
  if (targetType && targetType !== 'all') filter.targetType = targetType;
  if (action && action !== 'all') filter.action = action;
  if (search && typeof search === 'string' && search.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' };
    filter.$or = [{ action: regex }, { reason: regex }, { targetId: regex }];
  }

  const [data, total] = await Promise.all([
    AffiliateAuditLog.find(filter)
      .populate('actorId', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AffiliateAuditLog.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

export const AffiliateAdminService = {
  getAdminOverviewStats,
  getAdminAffiliatesList,
  getAdminAffiliateDetail,
  updateAffiliateStatus,
  getAdminCommissionsList,
  updateCommissionStatus,
  getAdminWithdrawalsList,
  processAffiliateWithdrawal,
  getAdminAuditLogs,
};

