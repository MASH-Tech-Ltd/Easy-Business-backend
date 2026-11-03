import mongoose, { Types } from 'mongoose';
import CustomError from '../../../helpers/CustomError';
import { paginationHelper } from '../../../helpers/paginationHelper';
import { Affiliate, AffiliateReferral, AffiliateCommission } from '../affiliate.model';
import { Tenant } from '../../tenant/tenant.model';
import { User } from '../../auth/auth.model';
import { Package } from '../../package/package.model';
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
 * Processes a qualifying paid subscription / payment for a referred merchant.
 * - Calculates commission based on ACTUAL amount paid (`paidAmount` after discounts).
 * - Enforces idempotency via `idempotencyKey` (`sub_${subscriptionId}`).
 * - Sets the 6-month (or snapshot duration) eligibility period on the first paid subscription.
 * - For subsequent renewals, checks that the payment falls within `[eligibilityStartDate, eligibilityEndDate]`.
 * - Credits the affiliate's available or pending balance atomically.
 */
const processQualifyingPayment = async (params: {
  tenantId: string | Types.ObjectId;
  subscription: any;
  paymentSubmission?: any;
}) => {
  try {
    const sub = params.subscription;
    if (!sub || sub.isTrial || sub.status !== 'active') {
      return null;
    }

    const referral = await AffiliateReferral.findOne({
      referredTenantId: new Types.ObjectId(params.tenantId.toString()),
    });
    if (!referral) {
      return null; // Merchant was not referred by an affiliate partner
    }

    const affiliate = await Affiliate.findById(referral.affiliateId);
    if (!affiliate || affiliate.status === 'deactivated' || affiliate.status === 'suspended') {
      return null;
    }

    const idempotencyKey = `sub_${sub._id.toString()}`;
    const existingCommission = await AffiliateCommission.findOne({ idempotencyKey });
    if (existingCommission) {
      return existingCommission; // Prevent duplicate commission generation
    }

    // Resolve package & actual paid amount
    let pkg: any = sub.packageId;
    if (!pkg || typeof pkg.price !== 'number') {
      pkg = await Package.findById(sub.packageId).lean();
    }

    const originalPrice = round2(Number(sub.originalPrice ?? pkg?.price ?? 0));
    let actualPaid = Number(
      params.paymentSubmission?.amount ?? sub.paidAmount ?? originalPrice
    );
    if (isNaN(actualPaid) || actualPaid < 0) actualPaid = 0;
    actualPaid = round2(actualPaid);

    // Only positive paid transactions generate commissions
    if (actualPaid <= 0) {
      return null;
    }

    const now = new Date();
    const snapshot = referral.commissionSnapshot || {
      commissionRate: 30,
      durationMonths: 6,
      commissionType: 'recurring',
      approvalMode: 'auto',
      holdDays: 0,
    };

    // Check one_time vs recurring
    if (snapshot.commissionType === 'one_time' && referral.paymentsCount > 0) {
      return null;
    }

    // Initialize or validate 6-month commission eligibility window
    let startWindow = referral.eligibilityStartDate
      ? new Date(referral.eligibilityStartDate)
      : null;
    let endWindow = referral.eligibilityEndDate ? new Date(referral.eligibilityEndDate) : null;

    if (!startWindow || !endWindow) {
      startWindow = now;
      endWindow = new Date(now);
      endWindow.setMonth(endWindow.getMonth() + Number(snapshot.durationMonths || 6));
      referral.eligibilityStartDate = startWindow;
      referral.eligibilityEndDate = endWindow;
      referral.eligibilityStatus = 'active';
    } else {
      // Check if current payment is within the eligibility period
      if (now > endWindow || referral.eligibilityStatus === 'revoked') {
        referral.eligibilityStatus = referral.eligibilityStatus === 'revoked' ? 'revoked' : 'expired';
        await referral.save();
        return null;
      }
    }

    const rate = Number(snapshot.commissionRate ?? 30);
    const commissionAmount = round2((actualPaid * rate) / 100);
    if (commissionAmount <= 0) return null;

    const globalConfig = await getAffiliateGlobalConfig();
    const isAvailableImmediately =
      snapshot.approvalMode === 'auto' && Number(snapshot.holdDays || 0) <= 0;

    const tenant = await Tenant.findById(params.tenantId).populate('ownerId', 'name email').lean();
    const ownerObj: any = tenant?.ownerId;
    const planName = pkg?.name || 'Subscription Plan';
    const cycleLabel = pkg?.billingCycle ? ` (${pkg.billingCycle})` : '';
    const paymentDescription = `${planName}${cycleLabel} — ${
      referral.paymentsCount === 0 ? 'Initial Subscription' : 'Recurring Renewal'
    }`;

    const session = await mongoose.startSession();
    session.startTransaction();

    let createdCommission: any = null;

    try {
      const [comm] = await AffiliateCommission.create(
        [
          {
            affiliateId: affiliate._id,
            affiliateUserId: affiliate.userId,
            referralId: referral._id,
            referredTenantId: referral.referredTenantId,
            referredMerchantName: ownerObj?.name || referral.referredStoreName,
            referredStoreName: tenant?.name || referral.referredStoreName,
            subscriptionId: new Types.ObjectId(sub._id.toString()),
            paymentSubmissionId: params.paymentSubmission?._id
              ? new Types.ObjectId(params.paymentSubmission._id.toString())
              : null,
            idempotencyKey,
            paymentDescription,
            originalPackagePrice: originalPrice,
            actualAmountPaid: actualPaid,
            commissionRate: rate,
            commissionAmount,
            currency: 'BDT',
            eligibilityPeriodStart: startWindow,
            eligibilityPeriodEnd: endWindow,
            status: isAvailableImmediately ? 'available' : 'pending',
            approvedAt: isAvailableImmediately ? now : null,
            settledAt: isAvailableImmediately ? now : null,
          },
        ],
        { session }
      );

      createdCommission = comm;

      // Update Referral stats
      const wasFirstPayment = referral.paymentsCount === 0;
      referral.subscriptionStatus = 'active';
      referral.paymentsCount = (referral.paymentsCount || 0) + 1;
      referral.totalPaidAmount = round2((referral.totalPaidAmount || 0) + actualPaid);
      referral.totalCommissionEarned = round2(
        (referral.totalCommissionEarned || 0) + commissionAmount
      );
      await referral.save({ session });

      if (wasFirstPayment) {
        await Affiliate.updateOne(
          { _id: affiliate._id },
          { $inc: { subscribedReferrals: 1 } },
          { session }
        );
      }

      // Credit affiliate balance & ledger
      await AffiliateBalanceService.creditCommission({
        affiliateId: affiliate._id,
        commissionId: comm!._id,
        amount: commissionAmount,
        isAvailableImmediately,
        description: `${rate}% commission on ৳${actualPaid} paid by ${
          tenant?.name || referral.referredStoreName
        } (${paymentDescription})`,
        session,
      });

      await session.commitTransaction();
      session.endSession();
    } catch (txErr: any) {
      await session.abortTransaction();
      session.endSession();
      // If duplicate key error due to race condition, return existing
      if (txErr?.code === 11000) {
        return AffiliateCommission.findOne({ idempotencyKey });
      }
      throw txErr;
    }

    // Post-transaction notifications & real-time events
    setImmediate(async () => {
      try {
        await recordAffiliateAuditLog({
          actorId: null,
          actorRole: 'system',
          action: 'COMMISSION_GENERATED',
          targetType: 'commission',
          targetId: createdCommission._id.toString(),
          metadata: {
            affiliateId: affiliate._id.toString(),
            referredStoreName: tenant?.name || referral.referredStoreName,
            actualAmountPaid: actualPaid,
            commissionRate: rate,
            commissionAmount,
            status: createdCommission.status,
          },
        });

        emitAffiliateSocketEvent(
          `affiliate_${affiliate._id.toString()}`,
          AFFILIATE_SOCKET_EVENTS.COMMISSION_CREATED,
          {
            commission: createdCommission,
          }
        );

        emitAffiliateSocketEvent(
          `affiliate_${affiliate._id.toString()}`,
          AFFILIATE_SOCKET_EVENTS.REFERRAL_SUBSCRIBED,
          {
            referralId: referral._id.toString(),
            referredStoreName: tenant?.name || referral.referredStoreName,
          }
        );

        emitAffiliateSocketEvent(
          'admin_affiliates',
          AFFILIATE_SOCKET_EVENTS.ADMIN_COMMISSION_GENERATED,
          {
            commission: createdCommission,
          }
        );

        if (globalConfig.notifications?.onCommissionGenerated !== false) {
          await notificationService.createNotification(
            affiliate.userId,
            'AFFILIATE_COMMISSION',
            'New Affiliate Commission Earned',
            `You earned ৳${commissionAmount} (${rate}% of ৳${actualPaid}) from "${
              tenant?.name || referral.referredStoreName
            }".`,
            createdCommission._id
          );
        }
      } catch (err) {
        console.error('[AffiliateCommission] Post-create notification error:', err);
      }
    });

    return createdCommission;
  } catch (err) {
    console.error('[AffiliateCommission] Error processing qualifying payment:', err);
    return null;
  }
};

/**
 * Reverses a commission if a subscription or payment is cancelled/refunded/rejected after approval,
 * or if an admin explicitly reverses it.
 */
const reverseCommission = async (params: {
  commissionId?: string | Types.ObjectId | undefined;
  subscriptionId?: string | Types.ObjectId | undefined;
  reason: string;
  actorId?: string | Types.ObjectId | null | undefined;
}) => {
  const query: any = {};
  if (params.commissionId) {
    query._id = new Types.ObjectId(params.commissionId.toString());
  } else if (params.subscriptionId) {
    query.subscriptionId = new Types.ObjectId(params.subscriptionId.toString());
  } else {
    return null;
  }

  const commission = await AffiliateCommission.findOne(query);
  if (!commission || commission.status === 'reversed' || commission.status === 'rejected') {
    return commission;
  }

  const wasAvailable = commission.status === 'available' || commission.status === 'approved' || commission.status === 'paid';

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    commission.status = 'reversed';
    commission.reversedAt = new Date();
    commission.reversalReason = params.reason || 'Payment reversed or refunded';
    if (params.actorId) {
      commission.adminActorId = new Types.ObjectId(params.actorId.toString());
    }
    await commission.save({ session });

    // Update referral totals
    await AffiliateReferral.updateOne(
      { _id: commission.referralId },
      {
        $inc: {
          totalPaidAmount: -commission.actualAmountPaid,
          totalCommissionEarned: -commission.commissionAmount,
        },
      },
      { session }
    );

    await AffiliateBalanceService.reverseCommissionBalance({
      affiliateId: commission.affiliateId,
      commissionId: commission._id,
      amount: commission.commissionAmount,
      wasAvailable,
      description: `Commission reversed (৳${commission.commissionAmount}): ${commission.reversalReason}`,
      actorId: params.actorId,
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
    actorId: params.actorId,
    actorRole: params.actorId ? 'super_admin' : 'system',
    action: 'COMMISSION_REVERSED',
    targetType: 'commission',
    targetId: commission._id.toString(),
    reason: params.reason,
    metadata: {
      commissionAmount: commission.commissionAmount,
      affiliateId: commission.affiliateId.toString(),
    },
  });

  emitAffiliateSocketEvent(
    `affiliate_${commission.affiliateId.toString()}`,
    AFFILIATE_SOCKET_EVENTS.COMMISSION_REVERSED,
    {
      commissionId: commission._id.toString(),
      amount: commission.commissionAmount,
      reason: commission.reversalReason,
    }
  );

  return commission;
};

/**
 * Paginated commission history for an Affiliate Partner with summary cards.
 */
const getAffiliateCommissions = async (affiliateId: string | Types.ObjectId, query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, startDate, endDate, sortBy = 'newest' } = query;

  const affObjId = new Types.ObjectId(affiliateId.toString());
  const filter: any = { affiliateId: affObjId };

  if (status && status !== 'all') {
    filter.status = status;
  }

  if (search && typeof search === 'string' && search.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' };
    filter.$or = [
      { referredStoreName: regex },
      { referredMerchantName: regex },
      { paymentDescription: regex },
    ];
  }

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) {
      const s = new Date(startDate);
      s.setHours(0, 0, 0, 0);
      filter.createdAt.$gte = s;
    }
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = e;
    }
  }

  let sortCriteria: any = { createdAt: -1 };
  if (sortBy === 'oldest') sortCriteria = { createdAt: 1 };
  else if (sortBy === 'amount_desc') sortCriteria = { commissionAmount: -1 };
  else if (sortBy === 'amount_asc') sortCriteria = { commissionAmount: 1 };

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [data, total, affiliate, monthAgg] = await Promise.all([
    AffiliateCommission.find(filter)
      .populate('referredTenantId', 'name slug domain customDomain')
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean(),
    AffiliateCommission.countDocuments(filter),
    Affiliate.findById(affObjId).lean(),
    AffiliateCommission.aggregate([
      {
        $match: {
          affiliateId: affObjId,
          status: { $in: ['pending', 'approved', 'available', 'paid'] },
          createdAt: { $gte: startOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          thisMonthCommission: { $sum: '$commissionAmount' },
        },
      },
    ]),
  ]);

  const thisMonthCommission = round2(monthAgg[0]?.thisMonthCommission || 0);

  return {
    data,
    summary: {
      totalCommissionEarned: round2(affiliate?.totalEarnings || 0),
      thisMonthCommission,
      pendingCommission: round2(affiliate?.pendingBalance || 0),
      availableCommissionBalance: round2(affiliate?.availableBalance || 0),
    },
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

export const AffiliateCommissionService = {
  processQualifyingPayment,
  reverseCommission,
  getAffiliateCommissions,
};

