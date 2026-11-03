import mongoose, { Types } from 'mongoose';
import CustomError from '../../../helpers/CustomError';
import { paginationHelper } from '../../../helpers/paginationHelper';
import { Affiliate, AffiliateWithdrawal } from '../affiliate.model';
import { User } from '../../auth/auth.model';
import { AffiliateBalanceService } from './balance.service';
import {
  round2,
  getAffiliateGlobalConfig,
  recordAffiliateAuditLog,
  emitAffiliateSocketEvent,
} from '../affiliate.utils';
import { AFFILIATE_SOCKET_EVENTS } from '../affiliate.constants';
import { notificationService } from '../../notification/notification.service';

/**
 * Creates a new withdrawal request for an active Affiliate Partner.
 * Enforces:
 * - Withdrawals enabled globally
 * - Affiliate account active
 * - Minimum withdrawal amount (default ৳100) and maximum limit
 * - Supported payment method
 * - No concurrent pending withdrawal request unless permitted
 * - Atomic balance reservation via `AffiliateBalanceService.reserveForWithdrawal`
 */
const requestWithdrawal = async (params: {
  affiliateId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
  amount: number;
  paymentMethod: 'bKash' | 'Nagad' | 'Rocket' | 'Bank';
  paymentDetails: {
    accountNumber: string;
    accountName: string;
    accountType?: string | undefined;
    bankName?: string | undefined;
    branchName?: string | undefined;
    routingNumber?: string | undefined;
  };
  ipAddress?: string | undefined;
}) => {
  const globalConfig = await getAffiliateGlobalConfig();
  if (!globalConfig.withdrawalsEnabled) {
    throw new CustomError(403, 'Affiliate withdrawals are currently paused by the administrator.');
  }

  const amount = round2(params.amount);
  const minAmount = Number(globalConfig.minimumWithdrawalAmount ?? 100);
  const maxAmount = Number(globalConfig.maximumWithdrawalAmount ?? 50000);

  if (amount < minAmount) {
    throw new CustomError(400, `Minimum withdrawal amount is ৳${minAmount}.`);
  }
  if (maxAmount > 0 && amount > maxAmount) {
    throw new CustomError(400, `Maximum withdrawal amount per request is ৳${maxAmount}.`);
  }

  const supportedMethods = Array.isArray(globalConfig.supportedMethods)
    ? globalConfig.supportedMethods
    : ['bKash', 'Nagad', 'Rocket', 'Bank'];

  if (!supportedMethods.includes(params.paymentMethod)) {
    throw new CustomError(
      400,
      `Payment method "${params.paymentMethod}" is not currently supported. Supported methods: ${supportedMethods.join(', ')}`
    );
  }

  const affiliate = await Affiliate.findById(params.affiliateId);
  if (!affiliate) {
    throw new CustomError(404, 'Affiliate account not found.');
  }
  if (affiliate.status !== 'active') {
    throw new CustomError(403, 'Only active affiliate accounts can request withdrawals.');
  }

  // Prevent duplicate pending withdrawal requests
  const existingPending = await AffiliateWithdrawal.findOne({
    affiliateId: affiliate._id,
    status: { $in: ['pending', 'processing'] },
  });
  if (existingPending) {
    throw new CustomError(
      400,
      'You already have a withdrawal request pending or in processing. Please wait for it to complete before submitting another.'
    );
  }

  if (round2(affiliate.availableBalance) < amount) {
    throw new CustomError(
      400,
      `Insufficient available balance. Available: ৳${round2(affiliate.availableBalance)}, Requested: ৳${amount}.`
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let withdrawal: any = null;

  try {
    const [created] = await AffiliateWithdrawal.create(
      [
        {
          affiliateId: affiliate._id,
          userId: new Types.ObjectId(params.userId.toString()),
          amount,
          currency: 'BDT',
          paymentMethod: params.paymentMethod,
          paymentDetails: {
            accountNumber: params.paymentDetails.accountNumber.trim(),
            accountName: params.paymentDetails.accountName.trim(),
            accountType: params.paymentDetails.accountType || 'Personal',
            bankName: params.paymentDetails.bankName || '',
            branchName: params.paymentDetails.branchName || '',
            routingNumber: params.paymentDetails.routingNumber || '',
          },
          status: 'pending',
          requestedAt: new Date(),
        },
      ],
      { session }
    );

    withdrawal = created;

    await AffiliateBalanceService.reserveForWithdrawal({
      affiliateId: affiliate._id,
      withdrawalId: created!._id,
      amount,
      description: `Withdrawal request of ৳${amount} via ${params.paymentMethod} (${params.paymentDetails.accountNumber})`,
      actorId: params.userId,
      session,
    });

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }

  // Audit log & real-time notifications
  setImmediate(async () => {
    try {
      await recordAffiliateAuditLog({
        actorId: params.userId,
        actorRole: 'affiliate_partner',
        action: 'WITHDRAWAL_REQUESTED',
        targetType: 'withdrawal',
        targetId: withdrawal._id.toString(),
        ipAddress: params.ipAddress,
        metadata: {
          affiliateId: affiliate._id.toString(),
          amount,
          paymentMethod: params.paymentMethod,
          accountNumber: params.paymentDetails.accountNumber,
        },
      });

      emitAffiliateSocketEvent(
        `affiliate_${affiliate._id.toString()}`,
        AFFILIATE_SOCKET_EVENTS.WITHDRAWAL_REQUESTED,
        {
          withdrawal,
        }
      );

      emitAffiliateSocketEvent(
        'admin_affiliates',
        AFFILIATE_SOCKET_EVENTS.ADMIN_WITHDRAWAL_REQUESTED,
        {
          withdrawal,
          affiliateCode: affiliate.affiliateCode,
        }
      );

      if (globalConfig.notifications?.onWithdrawalRequested !== false) {
        const superAdmins = await User.find({ role: 'super_admin' }).select('_id').lean();
        for (const admin of superAdmins) {
          await notificationService.createNotification(
            admin._id,
            'AFFILIATE_WITHDRAWAL_REQUEST',
            'New Affiliate Withdrawal Request',
            `Affiliate Partner (${affiliate.affiliateCode}) requested a withdrawal of ৳${amount} via ${params.paymentMethod}.`,
            withdrawal._id
          );
        }
      }
    } catch (e) {
      console.error('[AffiliateWithdrawal] Notification error:', e);
    }
  });

  return withdrawal;
};

/**
 * Paginated withdrawal history & summary cards for an Affiliate Partner.
 */
const getAffiliateWithdrawals = async (affiliateId: string | Types.ObjectId, query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { status, paymentMethod, startDate, endDate, sortBy = 'newest' } = query;

  const affObjId = new Types.ObjectId(affiliateId.toString());
  const filter: any = { affiliateId: affObjId };

  if (status && status !== 'all') {
    filter.status = status;
  }
  if (paymentMethod && paymentMethod !== 'all') {
    filter.paymentMethod = paymentMethod;
  }

  if (startDate || endDate) {
    filter.requestedAt = {};
    if (startDate) {
      const s = new Date(startDate);
      s.setHours(0, 0, 0, 0);
      filter.requestedAt.$gte = s;
    }
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      filter.requestedAt.$lte = e;
    }
  }

  let sortCriteria: any = { requestedAt: -1 };
  if (sortBy === 'oldest') sortCriteria = { requestedAt: 1 };
  else if (sortBy === 'amount_desc') sortCriteria = { amount: -1 };

  const [data, total, affiliate, globalConfig] = await Promise.all([
    AffiliateWithdrawal.find(filter).sort(sortCriteria).skip(skip).limit(limit).lean(),
    AffiliateWithdrawal.countDocuments(filter),
    Affiliate.findById(affObjId).lean(),
    getAffiliateGlobalConfig(),
  ]);

  return {
    data,
    summary: {
      availableBalance: round2(affiliate?.availableBalance || 0),
      pendingWithdrawalAmount: round2(affiliate?.reservedBalance || 0),
      totalWithdrawn: round2(affiliate?.totalWithdrawn || 0),
      minimumWithdrawalAmount: Number(globalConfig.minimumWithdrawalAmount ?? 100),
      maximumWithdrawalAmount: Number(globalConfig.maximumWithdrawalAmount ?? 50000),
      withdrawalsEnabled: Boolean(globalConfig.withdrawalsEnabled),
      supportedMethods: globalConfig.supportedMethods || ['bKash', 'Nagad', 'Rocket', 'Bank'],
    },
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

export const AffiliateWithdrawalService = {
  requestWithdrawal,
  getAffiliateWithdrawals,
};

