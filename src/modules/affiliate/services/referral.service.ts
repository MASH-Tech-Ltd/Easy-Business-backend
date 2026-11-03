import { ClientSession, Types } from 'mongoose';
import CustomError from '../../../helpers/CustomError';
import { paginationHelper } from '../../../helpers/paginationHelper';
import { Affiliate, AffiliateReferral } from '../affiliate.model';
import { User } from '../../auth/auth.model';
import { Tenant } from '../../tenant/tenant.model';
import { Subscription } from '../../subscription/subscription.model';
import {
  buildCommissionSnapshot,
  getAffiliateGlobalConfig,
  recordAffiliateAuditLog,
  emitAffiliateSocketEvent,
} from '../affiliate.utils';
import { AFFILIATE_SOCKET_EVENTS } from '../affiliate.constants';
import { notificationService } from '../../notification/notification.service';

/**
 * Validates whether a referral code belongs to an active Affiliate Partner.
 */
const validateAffiliateCode = async (rawCode: string) => {
  if (!rawCode || typeof rawCode !== 'string') return null;
  const cleanCode = rawCode.trim().toUpperCase();

  const globalConfig = await getAffiliateGlobalConfig();
  if (!globalConfig.programEnabled) return null;

  const affiliate = await Affiliate.findOne({ affiliateCode: cleanCode }).populate(
    'userId',
    'name email'
  );
  if (!affiliate) return null;

  if (affiliate.status !== 'active') {
    throw new CustomError(400, 'This affiliate referral code is currently inactive.');
  }

  const extraDays = Number(globalConfig.extraTrialDaysForReferredMerchant ?? 10);
  const referrerUser: any = affiliate.userId;

  return {
    valid: true,
    isAffiliateCode: true,
    affiliateId: affiliate._id,
    affiliateUserId: referrerUser?._id || affiliate.userId,
    code: affiliate.affiliateCode,
    offerType: 'trial_extension',
    extraDays,
    discountType: 'percentage',
    discountValue: 0,
    description: `Referred by Affiliate Partner (${referrerUser?.name || 'MASH Partner'})`,
    referrerName: referrerUser?.name || 'Affiliate Partner',
    isMerchantCode: false,
  };
};

/**
 * Tracks a public click on an affiliate referral link (`?ref=CODE`).
 */
const trackReferralClick = async (rawCode: string) => {
  if (!rawCode || typeof rawCode !== 'string') return { tracked: false };
  const cleanCode = rawCode.trim().toUpperCase();
  const updated = await Affiliate.findOneAndUpdate(
    { affiliateCode: cleanCode, status: 'active' },
    { $inc: { totalClicks: 1 } },
    { new: true }
  );
  return { tracked: Boolean(updated) };
};

/**
 * Attributes a newly registered merchant Tenant & User to an Affiliate Partner.
 * Enforces self-referral prevention and single-attribution uniqueness.
 */
const attributeMerchantRegistration = async (params: {
  affiliateCode: string;
  referredMerchantUserId: string | Types.ObjectId;
  referredTenantId: string | Types.ObjectId;
  referredStoreName: string;
  referredEmail: string;
  referredPhone?: string | undefined;
  session?: ClientSession | undefined;
}) => {
  const cleanCode = params.affiliateCode.trim().toUpperCase();
  const globalConfig = await getAffiliateGlobalConfig();
  if (!globalConfig.programEnabled) return null;

  const affiliate = await Affiliate.findOne({
    affiliateCode: cleanCode,
    status: 'active',
  }).session(params.session || null);

  if (!affiliate) return null;

  // Prevent self-referral by User ID, Email, or Phone
  const affiliateUser = await User.findById(affiliate.userId).session(params.session || null);
  if (
    affiliate.userId.toString() === params.referredMerchantUserId.toString() ||
    (affiliateUser?.email &&
      params.referredEmail &&
      affiliateUser.email.toLowerCase() === params.referredEmail.toLowerCase()) ||
    (affiliateUser?.phone &&
      params.referredPhone &&
      affiliateUser.phone.trim() === params.referredPhone.trim())
  ) {
    throw new CustomError(400, 'Self-referral is not permitted in the Affiliate Partner Program.');
  }

  // Ensure merchant tenant is not already attributed
  const existingAttribution = await AffiliateReferral.findOne({
    referredTenantId: params.referredTenantId,
  }).session(params.session || null);
  if (existingAttribution) return existingAttribution;

  const commissionSnapshot = await buildCommissionSnapshot(affiliate.commissionConfigOverride);

  const [referral] = await AffiliateReferral.create(
    [
      {
        affiliateId: affiliate._id,
        affiliateUserId: affiliate.userId,
        referredMerchantUserId: new Types.ObjectId(params.referredMerchantUserId.toString()),
        referredTenantId: new Types.ObjectId(params.referredTenantId.toString()),
        referredStoreName: params.referredStoreName,
        referredEmail: params.referredEmail,
        referralCodeUsed: cleanCode,
        registeredAt: new Date(),
        attributedAt: new Date(),
        subscriptionStatus: 'trial',
        eligibilityStatus: 'pending_first_payment',
        eligibilityStartDate: null,
        eligibilityEndDate: null,
        commissionSnapshot,
        totalPaidAmount: 0,
        totalCommissionEarned: 0,
        paymentsCount: 0,
      },
    ],
    { session: params.session || null }
  );

  affiliate.totalReferrals = (affiliate.totalReferrals || 0) + 1;
  affiliate.activeReferrals = (affiliate.activeReferrals || 0) + 1;
  await affiliate.save({ session: params.session || null });

  // Fire-and-forget post-registration notification & real-time event
  setImmediate(async () => {
    try {
      await recordAffiliateAuditLog({
        actorId: params.referredMerchantUserId,
        actorRole: 'tenant_admin',
        action: 'MERCHANT_REFERRED',
        targetType: 'referral',
        targetId: referral ? referral._id.toString() : '',
        metadata: {
          affiliateId: affiliate._id.toString(),
          affiliateCode: cleanCode,
          referredStoreName: params.referredStoreName,
        },
      });

      emitAffiliateSocketEvent(
        `affiliate_${affiliate._id.toString()}`,
        AFFILIATE_SOCKET_EVENTS.REFERRAL_CREATED,
        {
          referralId: referral?._id,
          referredStoreName: params.referredStoreName,
          registeredAt: new Date(),
        }
      );

      emitAffiliateSocketEvent('admin_affiliates', AFFILIATE_SOCKET_EVENTS.ADMIN_STATS_UPDATED, {
        type: 'referral_created',
      });

      await notificationService.createNotification(
        affiliate.userId,
        'AFFILIATE_REFERRAL',
        'New Merchant Referred',
        `Store "${params.referredStoreName}" registered using your referral code (${cleanCode}). You will earn ${commissionSnapshot.commissionRate}% commission when they subscribe!`,
        referral?._id,
        params.referredTenantId
      );
    } catch (e) {
      console.error('[AffiliateReferral] Notification error:', e);
    }
  });

  return referral;
};

/**
 * Paginated list of referred merchants for an Affiliate Partner with live subscription status sync.
 */
const getAffiliateReferrals = async (affiliateId: string | Types.ObjectId, query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, eligibilityStatus, startDate, endDate, sortBy = 'newest' } = query;

  const filter: any = { affiliateId: new Types.ObjectId(affiliateId.toString()) };

  if (search && typeof search === 'string' && search.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' };
    filter.$or = [{ referredStoreName: regex }, { referredEmail: regex }];
  }

  if (status && status !== 'all') {
    filter.subscriptionStatus = status;
  }

  if (eligibilityStatus && eligibilityStatus !== 'all') {
    filter.eligibilityStatus = eligibilityStatus;
  }

  if (startDate || endDate) {
    filter.registeredAt = {};
    if (startDate) {
      const s = new Date(startDate);
      s.setHours(0, 0, 0, 0);
      filter.registeredAt.$gte = s;
    }
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      filter.registeredAt.$lte = e;
    }
  }

  let sortCriteria: any = { registeredAt: -1 };
  if (sortBy === 'oldest') sortCriteria = { registeredAt: 1 };
  else if (sortBy === 'commission_desc') sortCriteria = { totalCommissionEarned: -1 };
  else if (sortBy === 'paid_desc') sortCriteria = { totalPaidAmount: -1 };

  const now = new Date();

  const [referrals, total, allForStats] = await Promise.all([
    AffiliateReferral.find(filter)
      .populate('referredTenantId', 'name slug domain customDomain status')
      .populate('referredMerchantUserId', 'name email phone')
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean(),
    AffiliateReferral.countDocuments(filter),
    AffiliateReferral.find({ affiliateId: new Types.ObjectId(affiliateId.toString()) }).lean(),
  ]);

  // Enrich with live eligibility status & active subscription check
  const tenantIds = referrals.map((r: any) => r.referredTenantId?._id || r.referredTenantId).filter(Boolean);
  const activeSubs = await Subscription.find({
    tenantId: { $in: tenantIds },
    status: 'active',
    endDate: { $gt: now },
  })
    .populate('packageId', 'name price billingCycle')
    .sort({ endDate: -1 })
    .lean();

  const subMap = new Map<string, any>();
  for (const s of activeSubs) {
    const tId = s.tenantId.toString();
    if (!subMap.has(tId)) subMap.set(tId, s);
  }

  const enriched = referrals.map((ref: any) => {
    const tId = (ref.referredTenantId?._id || ref.referredTenantId)?.toString();
    const liveSub = tId ? subMap.get(tId) : null;

    let computedSubStatus = ref.subscriptionStatus;
    if (liveSub) {
      computedSubStatus = liveSub.isTrial ? 'trial' : 'active';
    }

    let computedEligibility = ref.eligibilityStatus;
    if (
      computedEligibility === 'active' &&
      ref.eligibilityEndDate &&
      new Date(ref.eligibilityEndDate) < now
    ) {
      computedEligibility = 'expired';
    }

    return {
      ...ref,
      subscriptionStatus: computedSubStatus,
      eligibilityStatus: computedEligibility,
      currentPlanName: liveSub?.isTrial
        ? 'Free Trial'
        : (liveSub?.packageId as any)?.name || (computedSubStatus === 'active' ? 'Paid Plan' : 'No Active Plan'),
    };
  });

  // Compute summary stats across all referrals for this affiliate
  let totalReferred = allForStats.length;
  let activeReferred = 0;
  let subscribedMerchants = 0;
  let activeCommissionPeriods = 0;
  let expiredCommissionPeriods = 0;

  for (const r of allForStats) {
    if (r.subscriptionStatus === 'active' || r.subscriptionStatus === 'trial') {
      activeReferred++;
    }
    if (r.paymentsCount > 0 || r.subscriptionStatus === 'active') {
      subscribedMerchants++;
    }
    const isExpired =
      r.eligibilityStatus === 'expired' ||
      (r.eligibilityEndDate && new Date(r.eligibilityEndDate) < now);
    if (isExpired) {
      expiredCommissionPeriods++;
    } else if (r.eligibilityStatus === 'active') {
      activeCommissionPeriods++;
    }
  }

  return {
    data: enriched,
    stats: {
      totalReferredMerchants: totalReferred,
      activeReferredMerchants: activeReferred,
      subscribedMerchants,
      activeCommissionPeriods,
      expiredCommissionPeriods,
    },
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

export const AffiliateReferralService = {
  validateAffiliateCode,
  trackReferralClick,
  attributeMerchantRegistration,
  getAffiliateReferrals,
};

