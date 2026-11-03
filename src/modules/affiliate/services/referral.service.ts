import { ClientSession, Types } from 'mongoose';
import CustomError from '../../../helpers/CustomError';
import { paginationHelper } from '../../../helpers/paginationHelper';
import { Affiliate, AffiliateReferral, AffiliateCommission } from '../affiliate.model';
import { User } from '../../auth/auth.model';
import { Tenant } from '../../tenant/tenant.model';
import { Subscription } from '../../subscription/subscription.model';
import {
  buildCommissionSnapshot,
  getAffiliateGlobalConfig,
  recordAffiliateAuditLog,
  emitAffiliateSocketEvent,
  round2,
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
      .populate('referredTenantId', 'name slug domain customDomain status contactPhone contactEmail')
      .populate('referredMerchantUserId', 'name email phone status isActive')
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean(),
    AffiliateReferral.countDocuments(filter),
    AffiliateReferral.find({ affiliateId: new Types.ObjectId(affiliateId.toString()) }).lean(),
  ]);

  const tenantIds = referrals
    .map((r: any) => r.referredTenantId?._id || r.referredTenantId)
    .filter(Boolean);
  const referralIds = referrals.map((r: any) => r._id);

  // Fetch all subscriptions and commissions for these tenants and referrals
  const [allSubs, allCommissions] = await Promise.all([
    Subscription.find({ tenantId: { $in: tenantIds } })
      .populate('packageId', 'name price billingCycle durationDays')
      .sort({ createdAt: -1 })
      .lean(),
    AffiliateCommission.find({ referralId: { $in: referralIds } })
      .populate({
        path: 'subscriptionId',
        select: 'startDate endDate packageId paidAmount status',
        populate: { path: 'packageId', select: 'name price billingCycle durationDays' },
      })
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  // Group subscriptions by tenantId
  const subMap = new Map<string, any[]>();
  for (const s of allSubs) {
    const tId = s.tenantId.toString();
    if (!subMap.has(tId)) subMap.set(tId, []);
    subMap.get(tId)!.push(s);
  }

  // Group commissions by referralId
  const commMap = new Map<string, any[]>();
  for (const c of allCommissions) {
    const rId = c.referralId.toString();
    if (!commMap.has(rId)) commMap.set(rId, []);
    commMap.get(rId)!.push(c);
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const enriched = referrals.map((ref: any) => {
    const tId = (ref.referredTenantId?._id || ref.referredTenantId)?.toString();
    const rId = ref._id.toString();

    const subsForTenant = tId ? subMap.get(tId) || [] : [];
    const commissionsForRef = commMap.get(rId) || [];

    const tenant: any = ref.referredTenantId;
    const merchantUser: any = ref.referredMerchantUserId;

    const tenantStatus = tenant?.status || 'active';
    const userIsActive = merchantUser?.isActive !== false && merchantUser?.status !== 'suspended' && merchantUser?.status !== 'inactive';

    // Find active or latest subscription
    const activeSub =
      subsForTenant.find((s: any) => s.status === 'active' && new Date(s.endDate) > now) ||
      subsForTenant[0] ||
      null;

    let computedSubStatus = ref.subscriptionStatus;
    if (activeSub) {
      computedSubStatus = activeSub.isTrial ? 'trial' : 'active';
    }

    let computedEligibility = ref.eligibilityStatus;
    if (
      computedEligibility === 'active' &&
      ref.eligibilityEndDate &&
      new Date(ref.eligibilityEndDate) < now
    ) {
      computedEligibility = 'expired';
    }

    const isMerchantActive =
      tenantStatus === 'active' &&
      userIsActive &&
      (computedSubStatus === 'active' || computedSubStatus === 'trial');

    const daysRemainingInWindow =
      computedEligibility === 'active' && ref.eligibilityEndDate
        ? Math.max(
            0,
            Math.ceil(
              (new Date(ref.eligibilityEndDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            )
          )
        : 0;

    // Build monthly history breakdown
    const monthlyHistory = commissionsForRef.map((comm: any, idx: number) => {
      const commDate = new Date(comm.createdAt || Date.now());
      const monthLabel = `${monthNames[commDate.getMonth()]} ${commDate.getFullYear()}`;
      const subInfo: any = comm.subscriptionId;
      const pkgInfo: any = subInfo?.packageId;
      const packageName = pkgInfo?.name || comm.paymentDescription || 'Standard Subscription';
      const billingCycle = pkgInfo?.billingCycle || 'monthly';

      return {
        _id: comm._id ? comm._id.toString() : `comm_${idx}`,
        paymentNumber: idx + 1,
        monthLabel,
        packageName,
        billingCycle,
        periodStart: comm.eligibilityPeriodStart || subInfo?.startDate || comm.createdAt,
        periodEnd: comm.eligibilityPeriodEnd || subInfo?.endDate || null,
        paidAt: comm.createdAt,
        originalPackagePrice: round2(comm.originalPackagePrice || 0),
        actualAmountPaid: round2(comm.actualAmountPaid || 0),
        commissionRate: comm.commissionRate ?? (ref.commissionSnapshot?.commissionRate || 30),
        commissionAmount: round2(comm.commissionAmount || 0),
        status: comm.status || 'available',
        paymentDescription: comm.paymentDescription || `${packageName} payment`,
      };
    });

    // Build 6-Month recurring window tracker slots (Months 1 to 6)
    const durationMonths = Number(ref.commissionSnapshot?.durationMonths || 6);
    const sixMonthSlots = [];
    for (let slot = 1; slot <= durationMonths; slot++) {
      const matchedHistory = monthlyHistory[slot - 1];
      if (matchedHistory) {
        sixMonthSlots.push({
          slotNumber: slot,
          slotName: `Month ${slot}`,
          monthLabel: matchedHistory.monthLabel,
          packageName: matchedHistory.packageName,
          billingCycle: matchedHistory.billingCycle,
          amountPaid: matchedHistory.actualAmountPaid,
          commissionAmount: matchedHistory.commissionAmount,
          commissionRate: matchedHistory.commissionRate,
          paidAt: matchedHistory.paidAt,
          status: 'paid',
        });
      } else {
        const isWindowActive = computedEligibility === 'active';
        const isWindowExpired = computedEligibility === 'expired';
        sixMonthSlots.push({
          slotNumber: slot,
          slotName: `Month ${slot}`,
          monthLabel: `Eligible Month ${slot}`,
          packageName: (activeSub?.packageId as any)?.name || 'Standard Plan',
          billingCycle: (activeSub?.packageId as any)?.billingCycle || 'monthly',
          amountPaid: 0,
          commissionAmount: 0,
          commissionRate: ref.commissionSnapshot?.commissionRate || 30,
          paidAt: null,
          status: isWindowActive ? 'upcoming' : isWindowExpired ? 'expired' : 'pending',
        });
      }
    }

    const currentPkgName = activeSub?.isTrial
      ? 'Free Trial'
      : (activeSub?.packageId as any)?.name ||
        (computedSubStatus === 'active' ? 'Standard Plan' : 'No Active Plan');

    return {
      ...ref,
      subscriptionStatus: computedSubStatus,
      eligibilityStatus: computedEligibility,
      isMerchantActive,
      merchantName: merchantUser?.name || ref.referredStoreName || 'Merchant',
      merchantEmail: merchantUser?.email || ref.referredEmail || '',
      merchantPhone: merchantUser?.phone || tenant?.contactPhone || '',
      storeName: ref.referredStoreName || tenant?.name || 'Store',
      storeStatus: tenantStatus,
      storeSlug: tenant?.slug || '',
      storeDomain: tenant?.customDomain || tenant?.domain || tenant?.slug || '',
      currentPackage: {
        name: currentPkgName,
        price: (activeSub?.packageId as any)?.price ?? (activeSub?.paidAmount ?? 0),
        billingCycle: (activeSub?.packageId as any)?.billingCycle || 'monthly',
        startDate: activeSub?.startDate || null,
        endDate: activeSub?.endDate || null,
        isTrial: Boolean(activeSub?.isTrial),
        status: activeSub?.status || computedSubStatus,
      },
      currentPlanName: currentPkgName,
      daysRemainingInWindow,
      commissionRate: ref.commissionSnapshot?.commissionRate ?? 30,
      durationMonths,
      monthlyHistory,
      sixMonthSlots,
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

/**
 * Retrieves full details for a single referred merchant by ID.
 */
const getAffiliateReferralById = async (
  affiliateId: string | Types.ObjectId,
  referralId: string | Types.ObjectId
) => {
  const now = new Date();
  const referral = await AffiliateReferral.findOne({
    _id: new Types.ObjectId(referralId.toString()),
    affiliateId: new Types.ObjectId(affiliateId.toString()),
  })
    .populate('referredTenantId', 'name slug domain customDomain status contactPhone contactEmail')
    .populate('referredMerchantUserId', 'name email phone status isActive')
    .lean();

  if (!referral) {
    throw new CustomError(404, 'Referred merchant not found');
  }

  const tenantId = referral.referredTenantId?._id || referral.referredTenantId;

  const [subsForTenant, commissionsForRef] = await Promise.all([
    tenantId
      ? Subscription.find({ tenantId })
          .populate('packageId', 'name price billingCycle durationDays')
          .sort({ createdAt: -1 })
          .lean()
      : [],
    AffiliateCommission.find({ referralId: referral._id })
      .populate({
        path: 'subscriptionId',
        select: 'startDate endDate packageId paidAmount status',
        populate: { path: 'packageId', select: 'name price billingCycle durationDays' },
      })
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const tenant: any = referral.referredTenantId;
  const merchantUser: any = referral.referredMerchantUserId;

  const tenantStatus = tenant?.status || 'active';
  const userIsActive =
    merchantUser?.isActive !== false &&
    merchantUser?.status !== 'suspended' &&
    merchantUser?.status !== 'inactive';

  const activeSub =
    subsForTenant.find((s: any) => s.status === 'active' && new Date(s.endDate) > now) ||
    subsForTenant[0] ||
    null;

  let computedSubStatus = referral.subscriptionStatus;
  if (activeSub) {
    computedSubStatus = activeSub.isTrial ? 'trial' : 'active';
  }

  let computedEligibility = referral.eligibilityStatus;
  if (
    computedEligibility === 'active' &&
    referral.eligibilityEndDate &&
    new Date(referral.eligibilityEndDate) < now
  ) {
    computedEligibility = 'expired';
  }

  const isMerchantActive =
    tenantStatus === 'active' &&
    userIsActive &&
    (computedSubStatus === 'active' || computedSubStatus === 'trial');

  const daysRemainingInWindow =
    computedEligibility === 'active' && referral.eligibilityEndDate
      ? Math.max(
          0,
          Math.ceil(
            (new Date(referral.eligibilityEndDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          )
        )
      : 0;

  const monthlyHistory = commissionsForRef.map((comm: any, idx: number) => {
    const commDate = new Date(comm.createdAt || Date.now());
    const monthLabel = `${monthNames[commDate.getMonth()]} ${commDate.getFullYear()}`;
    const subInfo: any = comm.subscriptionId;
    const pkgInfo: any = subInfo?.packageId;
    const packageName = pkgInfo?.name || comm.paymentDescription || 'Standard Subscription';
    const billingCycle = pkgInfo?.billingCycle || 'monthly';

    return {
      _id: comm._id ? comm._id.toString() : `comm_${idx}`,
      paymentNumber: idx + 1,
      monthLabel,
      packageName,
      billingCycle,
      periodStart: comm.eligibilityPeriodStart || subInfo?.startDate || comm.createdAt,
      periodEnd: comm.eligibilityPeriodEnd || subInfo?.endDate || null,
      paidAt: comm.createdAt,
      originalPackagePrice: round2(comm.originalPackagePrice || 0),
      actualAmountPaid: round2(comm.actualAmountPaid || 0),
      commissionRate: comm.commissionRate ?? (referral.commissionSnapshot?.commissionRate || 30),
      commissionAmount: round2(comm.commissionAmount || 0),
      status: comm.status || 'available',
      paymentDescription: comm.paymentDescription || `${packageName} payment`,
    };
  });

  const durationMonths = Number(referral.commissionSnapshot?.durationMonths || 6);
  const sixMonthSlots = [];
  for (let slot = 1; slot <= durationMonths; slot++) {
    const matchedHistory = monthlyHistory[slot - 1];
    if (matchedHistory) {
      sixMonthSlots.push({
        slotNumber: slot,
        slotName: `Month ${slot}`,
        monthLabel: matchedHistory.monthLabel,
        packageName: matchedHistory.packageName,
        billingCycle: matchedHistory.billingCycle,
        amountPaid: matchedHistory.actualAmountPaid,
        commissionAmount: matchedHistory.commissionAmount,
        commissionRate: matchedHistory.commissionRate,
        paidAt: matchedHistory.paidAt,
        status: 'paid',
      });
    } else {
      const isWindowActive = computedEligibility === 'active';
      const isWindowExpired = computedEligibility === 'expired';
      sixMonthSlots.push({
        slotNumber: slot,
        slotName: `Month ${slot}`,
        monthLabel: `Eligible Month ${slot}`,
        packageName: (activeSub?.packageId as any)?.name || 'Standard Plan',
        billingCycle: (activeSub?.packageId as any)?.billingCycle || 'monthly',
        amountPaid: 0,
        commissionAmount: 0,
        commissionRate: referral.commissionSnapshot?.commissionRate || 30,
        paidAt: null,
        status: isWindowActive ? 'upcoming' : isWindowExpired ? 'expired' : 'pending',
      });
    }
  }

  const currentPkgName = activeSub?.isTrial
    ? 'Free Trial'
    : (activeSub?.packageId as any)?.name ||
      (computedSubStatus === 'active' ? 'Standard Plan' : 'No Active Plan');

  return {
    ...referral,
    subscriptionStatus: computedSubStatus,
    eligibilityStatus: computedEligibility,
    isMerchantActive,
    merchantName: merchantUser?.name || referral.referredStoreName || 'Merchant',
    merchantEmail: merchantUser?.email || referral.referredEmail || '',
    merchantPhone: merchantUser?.phone || tenant?.contactPhone || '',
    storeName: referral.referredStoreName || tenant?.name || 'Store',
    storeStatus: tenantStatus,
    storeSlug: tenant?.slug || '',
    storeDomain: tenant?.customDomain || tenant?.domain || tenant?.slug || '',
    currentPackage: {
      name: currentPkgName,
      price: (activeSub?.packageId as any)?.price ?? (activeSub?.paidAmount ?? 0),
      billingCycle: (activeSub?.packageId as any)?.billingCycle || 'monthly',
      startDate: activeSub?.startDate || null,
      endDate: activeSub?.endDate || null,
      isTrial: Boolean(activeSub?.isTrial),
      status: activeSub?.status || computedSubStatus,
    },
    currentPlanName: currentPkgName,
    daysRemainingInWindow,
    commissionRate: referral.commissionSnapshot?.commissionRate ?? 30,
    durationMonths,
    monthlyHistory,
    sixMonthSlots,
  };
};

export const AffiliateReferralService = {
  validateAffiliateCode,
  trackReferralClick,
  attributeMerchantRegistration,
  getAffiliateReferrals,
  getAffiliateReferralById,
};

