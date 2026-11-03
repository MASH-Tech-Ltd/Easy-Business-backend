import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../../../config';
import CustomError from '../../../helpers/CustomError';
import { paginationHelper } from '../../../helpers/paginationHelper';
import { User } from '../../auth/auth.model';
import {
  Affiliate,
  AffiliateReferral,
  AffiliateLedger,
} from '../affiliate.model';
import {
  round2,
  getAffiliateGlobalConfig,
  generateUniqueAffiliateCode,
  recordAffiliateAuditLog,
  emitAffiliateSocketEvent,
} from '../affiliate.utils';
import { AFFILIATE_SOCKET_EVENTS } from '../affiliate.constants';
import { notificationService } from '../../notification/notification.service';
import { SupportTicket } from '../../support/support.model';
import { supportService } from '../../support/support.service';

/**
 * Returns public affiliate program settings for the Affiliate Landing Page & Registration Page.
 */
const getPublicConfig = async () => {
  const [globalConfig, totalRegisteredAffiliates] = await Promise.all([
    getAffiliateGlobalConfig(),
    Affiliate.countDocuments(),
  ]);

  const maxAffiliates = Number(globalConfig.maxAffiliates ?? 500);
  const isFull = maxAffiliates > 0 && totalRegisteredAffiliates >= maxAffiliates;

  return {
    programEnabled: Boolean(globalConfig.programEnabled),
    allowAffiliateRegistration: Boolean(
      globalConfig.programEnabled && globalConfig.allowAffiliateRegistration && !isFull
    ),
    registrationClosedReason: !globalConfig.programEnabled
      ? 'PROGRAM_DISABLED'
      : !globalConfig.allowAffiliateRegistration
      ? 'REGISTRATION_DISABLED'
      : isFull
      ? 'MAX_LIMIT_REACHED'
      : null,
    maxAffiliates,
    currentAffiliateCount: totalRegisteredAffiliates,
    defaultCommissionRate: Number(globalConfig.defaultCommissionRate ?? 30),
    commissionDurationMonths: Number(globalConfig.commissionDurationMonths ?? 6),
    commissionType: globalConfig.commissionType || 'recurring',
    minimumWithdrawalAmount: Number(globalConfig.minimumWithdrawalAmount ?? 100),
    extraTrialDaysForReferredMerchant: Number(
      globalConfig.extraTrialDaysForReferredMerchant ?? 10
    ),
    supportedMethods: globalConfig.supportedMethods || ['bKash', 'Nagad', 'Rocket', 'Bank'],
    termsAndConditions: globalConfig.termsAndConditions || '',
  };
};

/**
 * Registers a new Affiliate Partner (`role: 'affiliate_partner'`).
 * Enforces:
 * - `programEnabled` and `allowAffiliateRegistration`
 * - `maxAffiliates` capacity limit
 * - Unique email check
 * - Unique referral code generation
 */
const registerAffiliate = async (params: {
  name: string;
  email: string;
  phone: string;
  password: string;
  referralCode?: string | undefined;
  ipAddress?: string | undefined;
}) => {
  const globalConfig = await getAffiliateGlobalConfig();

  if (!globalConfig.programEnabled) {
    throw new CustomError(
      403,
      'The Affiliate Partner Program is currently disabled by the system administrator.'
    );
  }

  if (globalConfig.allowAffiliateRegistration === false) {
    throw new CustomError(
      403,
      'New Affiliate Partner registration is currently closed by the administrator.'
    );
  }

  const maxAffiliates = Number(globalConfig.maxAffiliates ?? 500);
  if (maxAffiliates > 0) {
    const currentCount = await Affiliate.countDocuments();
    if (currentCount >= maxAffiliates) {
      throw new CustomError(
        403,
        `Maximum Affiliate Partner registration limit (${maxAffiliates}) has been reached. Registration is currently full.`
      );
    }
  }

  const cleanEmail = params.email.trim().toLowerCase();
  const existingUser = await User.findOne({ email: cleanEmail });
  if (existingUser) {
    throw new CustomError(
      409,
      'An account with this email address already exists. Please use a different email or log in.'
    );
  }

  let referredByAffiliateId: Types.ObjectId | null = null;
  if (params.referralCode && params.referralCode.trim()) {
    const parentAff = await Affiliate.findOne({
      affiliateCode: params.referralCode.trim().toUpperCase(),
      status: 'active',
    });
    if (parentAff) {
      referredByAffiliateId = parentAff._id as Types.ObjectId;
    }
  }

  const affiliateCode = await generateUniqueAffiliateCode(globalConfig.referralCodePrefix || 'MASH');
  const initialStatus = globalConfig.approvalMode === 'manual' ? 'pending' : 'active';

  const session = await mongoose.startSession();
  session.startTransaction();

  let createdUser: any = null;
  let createdAffiliate: any = null;

  try {
    const user = new User({
      name: params.name.trim(),
      email: cleanEmail,
      phone: params.phone.trim(),
      password: params.password,
      role: 'affiliate_partner',
    });
    await user.save({ session });
    createdUser = user;

    const [affiliate] = await Affiliate.create(
      [
        {
          userId: user._id,
          affiliateCode,
          status: initialStatus,
          referredByAffiliateId,
          approvedAt: initialStatus === 'active' ? new Date() : null,
        },
      ],
      { session }
    );
    createdAffiliate = affiliate;

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }

  const familyId = crypto.randomBytes(8).toString('hex');
  const jwtPayload = {
    _id: createdUser._id,
    email: createdUser.email,
    role: createdUser.role,
    affiliateId: createdAffiliate._id,
    familyId,
  };

  const accessToken = jwt.sign(jwtPayload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn as any,
  });

  const refreshToken = jwt.sign(jwtPayload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as any,
  });

  await User.updateOne(
    { _id: createdUser._id },
    {
      $push: {
        refreshTokens: {
          token: refreshToken,
          familyId,
        },
      },
    }
  );

  // Post-registration audit & notifications
  setImmediate(async () => {
    try {
      await recordAffiliateAuditLog({
        actorId: createdUser._id,
        actorRole: 'affiliate_partner',
        action: 'AFFILIATE_REGISTERED',
        targetType: 'affiliate',
        targetId: createdAffiliate._id.toString(),
        ipAddress: params.ipAddress,
        metadata: {
          name: createdUser.name,
          email: createdUser.email,
          affiliateCode,
          status: initialStatus,
        },
      });

      emitAffiliateSocketEvent(
        'admin_affiliates',
        AFFILIATE_SOCKET_EVENTS.ADMIN_AFFILIATE_REGISTERED,
        {
          affiliateId: createdAffiliate._id.toString(),
          name: createdUser.name,
          email: createdUser.email,
          affiliateCode,
          status: initialStatus,
        }
      );

      await notificationService.createNotification(
        createdUser._id,
        'WELCOME_AFFILIATE',
        'Welcome to MASH ECO Affiliate Partner Program!',
        `Your unique referral code is ${affiliateCode}. Share your referral link to earn ${globalConfig.defaultCommissionRate}% commission for ${globalConfig.commissionDurationMonths} months!`,
        createdAffiliate._id
      );

      if (globalConfig.notifications?.onRegistration !== false) {
        const superAdmins = await User.find({ role: 'super_admin' }).select('_id').lean();
        for (const admin of superAdmins) {
          await notificationService.createNotification(
            admin._id,
            'AFFILIATE_REGISTERED',
            'New Affiliate Partner Registered',
            `${createdUser.name} (${createdUser.email}) joined as an Affiliate Partner with code ${affiliateCode}.`,
            createdAffiliate._id
          );
        }
      }
    } catch (e) {
      console.error('[AffiliateRegister] Notification error:', e);
    }
  });

  const userObj = createdUser.toObject();
  delete userObj.password;
  delete userObj.refreshTokens;

  return {
    user: {
      ...userObj,
      affiliateId: createdAffiliate._id,
      affiliateCode: createdAffiliate.affiliateCode,
      affiliateStatus: createdAffiliate.status,
    },
    affiliate: createdAffiliate,
    accessToken,
    refreshToken,
  };
};

/**
 * Logs in an Affiliate Partner (`role === 'affiliate_partner'`).
 */
const loginAffiliate = async (params: {
  email: string;
  password: string;
  ipAddress?: string | undefined;
}) => {
  const cleanEmail = params.email.trim().toLowerCase();
  const user = await User.findOne({ email: cleanEmail }).select('+password');

  if (!user || !user.password) {
    await bcrypt.compare(params.password, '$2b$12$dummyhashthatis29charslo');
    throw new CustomError(401, 'Invalid email or password.');
  }

  const isMatch = await bcrypt.compare(params.password, user.password);
  if (!isMatch) {
    throw new CustomError(401, 'Invalid email or password.');
  }

  if (user.role !== 'affiliate_partner') {
    throw new CustomError(
      403,
      'This account is not registered as an Affiliate Partner. Please use the Affiliate Partner Registration page.'
    );
  }

  const affiliate = await Affiliate.findOne({ userId: user._id });
  if (!affiliate) {
    throw new CustomError(404, 'Affiliate partner profile not found.');
  }

  if (affiliate.status === 'deactivated') {
    throw new CustomError(
      403,
      'Your affiliate partner account has been deactivated. Please contact support.'
    );
  }

  const familyId = crypto.randomBytes(8).toString('hex');
  const jwtPayload = {
    _id: user._id,
    email: user.email,
    role: user.role,
    affiliateId: affiliate._id,
    familyId,
  };

  const accessToken = jwt.sign(jwtPayload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn as any,
  });

  const refreshToken = jwt.sign(jwtPayload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as any,
  });

  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        refreshTokens: {
          token: refreshToken,
          familyId,
        },
      },
    }
  );

  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.refreshTokens;

  return {
    user: {
      ...userObj,
      affiliateId: affiliate._id,
      affiliateCode: affiliate.affiliateCode,
      affiliateStatus: affiliate.status,
    },
    affiliate,
    accessToken,
    refreshToken,
  };
};

const buildMerchantReferralLink = (affiliateCode: string): string => {
  const configuredRegisterUrl = process.env.MERCHANT_REGISTER_URL?.trim();
  if (configuredRegisterUrl) {
    const clean = configuredRegisterUrl.replace(/\/+$/, '');
    return `${clean}?ref=${encodeURIComponent(affiliateCode)}`;
  }

  const configuredBaseUrl = process.env.MERCHANT_DASHBOARD_URL?.trim();
  if (configuredBaseUrl) {
    const cleanBase = configuredBaseUrl.replace(/\/+$/, '');
    const registerUrl = cleanBase.endsWith('/register') ? cleanBase : `${cleanBase}/register`;
    return `${registerUrl}?ref=${encodeURIComponent(affiliateCode)}`;
  }

  const defaultRegisterUrl =
    process.env.NODE_ENV === 'production'
      ? 'https://merchant.masheco.com/register'
      : 'http://localhost:3000/register';

  return `${defaultRegisterUrl}?ref=${encodeURIComponent(affiliateCode)}`;
};

/**
 * Returns the authenticated Affiliate Partner's profile & live program settings.
 */
const getMe = async (userId: string | Types.ObjectId) => {
  const [user, affiliate, globalConfig] = await Promise.all([
    User.findById(userId).select('-password -refreshTokens').lean(),
    Affiliate.findOne({ userId }).lean(),
    getAffiliateGlobalConfig(),
  ]);

  if (!user || !affiliate) {
    throw new CustomError(404, 'Affiliate partner profile not found');
  }

  return {
    user,
    affiliate: {
      ...affiliate,
      totalEarnings: round2(affiliate.totalEarnings),
      availableBalance: round2(affiliate.availableBalance),
      pendingBalance: round2(affiliate.pendingBalance),
      reservedBalance: round2(affiliate.reservedBalance),
      totalWithdrawn: round2(affiliate.totalWithdrawn),
      referralLink: buildMerchantReferralLink(affiliate.affiliateCode),
    },
    programConfig: {
      commissionRate:
        affiliate.commissionConfigOverride?.commissionRate ??
        Number(globalConfig.defaultCommissionRate ?? 30),
      commissionDurationMonths:
        affiliate.commissionConfigOverride?.durationMonths ??
        Number(globalConfig.commissionDurationMonths ?? 6),
      commissionType:
        affiliate.commissionConfigOverride?.commissionType ??
        (globalConfig.commissionType || 'recurring'),
      minimumWithdrawalAmount: Number(globalConfig.minimumWithdrawalAmount ?? 100),
      maximumWithdrawalAmount: Number(globalConfig.maximumWithdrawalAmount ?? 50000),
      withdrawalsEnabled: Boolean(globalConfig.withdrawalsEnabled),
      supportedMethods: globalConfig.supportedMethods || ['bKash', 'Nagad', 'Rocket', 'Bank'],
    },
  };
};

/**
 * Dashboard Overview Page data:
 * - 5 Summary Cards (Total Referrals, Active Referrals, Total Earnings, Available Balance, Total Withdrawn)
 * - Paginated Recent Referrals
 * - Paginated Recent Financial Ledger Transactions
 */
const getOverview = async (affiliateId: string | Types.ObjectId, query: any = {}) => {
  const affObjId = new Types.ObjectId(affiliateId.toString());
  const refPage = paginationHelper(query?.refPage || 1, query?.refLimit || 5);
  const txPage = paginationHelper(query?.txPage || 1, query?.txLimit || 5);

  const [
    affiliate,
    recentReferrals,
    totalReferralsCount,
    activeReferralsCount,
    recentTransactions,
    totalTransactionsCount,
    globalConfig,
  ] = await Promise.all([
    Affiliate.findById(affObjId).populate('userId', 'name email phone avatar').lean(),
    AffiliateReferral.find({ affiliateId: affObjId })
      .populate('referredTenantId', 'name slug domain customDomain status')
      .populate('referredMerchantUserId', 'name email phone status isActive')
      .sort({ registeredAt: -1 })
      .skip(refPage.skip)
      .limit(refPage.limit)
      .lean(),
    AffiliateReferral.countDocuments({ affiliateId: affObjId }),
    AffiliateReferral.countDocuments({
      affiliateId: affObjId,
      subscriptionStatus: { $in: ['active', 'trial'] },
    }),
    AffiliateLedger.find({ affiliateId: affObjId })
      .sort({ createdAt: -1 })
      .skip(txPage.skip)
      .limit(txPage.limit)
      .lean(),
    AffiliateLedger.countDocuments({ affiliateId: affObjId }),
    getAffiliateGlobalConfig(),
  ]);

  if (!affiliate) {
    throw new CustomError(404, 'Affiliate profile not found');
  }

  return {
    summary: {
      totalReferrals: totalReferralsCount,
      activeReferrals: activeReferralsCount,
      subscribedReferrals: affiliate.subscribedReferrals || 0,
      totalClicks: affiliate.totalClicks || 0,
      totalEarnings: round2(affiliate.totalEarnings),
      availableBalance: round2(affiliate.availableBalance),
      pendingBalance: round2(affiliate.pendingBalance),
      reservedBalance: round2(affiliate.reservedBalance),
      totalWithdrawn: round2(affiliate.totalWithdrawn),
    },
    affiliate: {
      _id: affiliate._id,
      affiliateCode: affiliate.affiliateCode,
      status: affiliate.status,
      suspensionReason: affiliate.suspensionReason,
      referralLink: buildMerchantReferralLink(affiliate.affiliateCode),
      commissionRate:
        affiliate.commissionConfigOverride?.commissionRate ??
        Number(globalConfig.defaultCommissionRate ?? 30),
      commissionDurationMonths:
        affiliate.commissionConfigOverride?.durationMonths ??
        Number(globalConfig.commissionDurationMonths ?? 6),
    },
    recentReferrals: {
      data: recentReferrals,
      meta: {
        page: refPage.page,
        limit: refPage.limit,
        total: totalReferralsCount,
        totalPages: Math.ceil(totalReferralsCount / refPage.limit) || 1,
      },
    },
    recentTransactions: {
      data: recentTransactions,
      meta: {
        page: txPage.page,
        limit: txPage.limit,
        total: totalTransactionsCount,
        totalPages: Math.ceil(totalTransactionsCount / txPage.limit) || 1,
      },
    },
  };
};

/**
 * Updates Affiliate Partner profile information (Full Name, Phone, Address, Avatar).
 */
const updateProfile = async (
  userId: string | Types.ObjectId,
  payload: {
    name?: string | undefined;
    phone?: string | undefined;
    address?: string | undefined;
    avatarUrl?: string | undefined;
  },
  ipAddress?: string | undefined
) => {
  const user = await User.findById(userId);
  if (!user) throw new CustomError(404, 'User not found');

  if (payload.name !== undefined) user.name = payload.name.trim();
  if (payload.phone !== undefined) user.phone = payload.phone.trim();
  if (payload.address !== undefined) user.address = payload.address.trim();
  if (payload.avatarUrl !== undefined) {
    const trimmedAvatar = payload.avatarUrl.trim();
    user.avatar = trimmedAvatar
      ? {
          public_id: `affiliate_avatar_${user._id.toString()}`,
          secure_url: trimmedAvatar,
        }
      : { public_id: '', secure_url: '' };
  }

  await user.save();

  await recordAffiliateAuditLog({
    actorId: user._id,
    actorRole: 'affiliate_partner',
    action: 'PROFILE_UPDATED',
    targetType: 'affiliate',
    targetId: user._id.toString(),
    ipAddress,
    metadata: { name: user.name, phone: user.phone },
  });

  const clean = user.toObject();
  delete clean.password;
  delete clean.refreshTokens;
  return clean;
};

/**
 * Changes the Affiliate Partner's password after verifying `oldPassword`.
 */
const changePassword = async (
  userId: string | Types.ObjectId,
  payload: { oldPassword: string; newPassword: string },
  ipAddress?: string | undefined
) => {
  const user = await User.findById(userId).select('+password');
  if (!user || !user.password) throw new CustomError(404, 'User not found');

  const isMatch = await bcrypt.compare(payload.oldPassword, user.password);
  if (!isMatch) {
    throw new CustomError(400, 'Current password is incorrect.');
  }

  user.password = payload.newPassword;
  await user.save();

  await recordAffiliateAuditLog({
    actorId: user._id,
    actorRole: 'affiliate_partner',
    action: 'PASSWORD_CHANGED',
    targetType: 'affiliate',
    targetId: user._id.toString(),
    ipAddress,
  });

  return { updated: true };
};

/**
 * Updates saved payout methods (bKash, Nagad, Rocket, Bank) for withdrawals.
 */
const updatePaymentMethods = async (
  affiliateId: string | Types.ObjectId,
  userId: string | Types.ObjectId,
  paymentMethods: any[],
  ipAddress?: string | undefined
) => {
  const affiliate = await Affiliate.findById(affiliateId);
  if (!affiliate) throw new CustomError(404, 'Affiliate profile not found');

  const normalized = (paymentMethods || []).map((pm, idx) => ({
    id: pm.id || `pm_${Date.now()}_${idx}`,
    method: pm.method,
    accountType: pm.accountType || 'Personal',
    accountNumber: pm.accountNumber.trim(),
    accountName: pm.accountName.trim(),
    bankName: pm.bankName || '',
    branchName: pm.branchName || '',
    routingNumber: pm.routingNumber || '',
    isDefault: idx === 0 ? true : Boolean(pm.isDefault),
  }));

  // Ensure only one default
  const defaultIdx = normalized.findIndex((m) => m.isDefault);
  normalized.forEach((m, i) => {
    m.isDefault = i === (defaultIdx >= 0 ? defaultIdx : 0);
  });

  affiliate.paymentMethods = normalized;
  await affiliate.save();

  await recordAffiliateAuditLog({
    actorId: userId,
    actorRole: 'affiliate_partner',
    action: 'PAYMENT_METHODS_UPDATED',
    targetType: 'affiliate',
    targetId: affiliate._id.toString(),
    ipAddress,
    metadata: { count: normalized.length },
  });

  return affiliate.paymentMethods;
};

/**
 * Paginated ledger transactions for the Affiliate Partner.
 */
const getLedgerTransactions = async (affiliateId: string | Types.ObjectId, query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const affObjId = new Types.ObjectId(affiliateId.toString());

  const filter: any = { affiliateId: affObjId };
  if (query.type && query.type !== 'all') {
    filter.type = query.type;
  }

  const [data, total] = await Promise.all([
    AffiliateLedger.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AffiliateLedger.countDocuments(filter),
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
 * Affiliate Partner Support Tickets
 */
const getSupportTickets = async (
  affiliateId: string | Types.ObjectId,
  userId: string | Types.ObjectId
) => {
  const affObjId = new Types.ObjectId(affiliateId.toString());
  const userObjId = new Types.ObjectId(userId.toString());
  const tickets = await SupportTicket.find({
    $or: [{ affiliateId: affObjId }, { userId: userObjId }],
  })
    .sort({ updatedAt: -1 })
    .lean();
  return tickets;
};

const createSupportTicket = async (params: {
  affiliateId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
  subject: string;
  category?: string | undefined;
  priority?: string | undefined;
  message: string;
}) => {
  const affObjId = new Types.ObjectId(params.affiliateId.toString());
  const userObjId = new Types.ObjectId(params.userId.toString());
  const cleanPriority = ['LOW', 'MEDIUM', 'HIGH'].includes(
    (params.priority || '').toUpperCase()
  )
    ? ((params.priority || 'MEDIUM').toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH')
    : 'MEDIUM';

  const ticket = await SupportTicket.create({
    ticketId: supportService.generateTicketId(),
    affiliateId: affObjId,
    userId: userObjId,
    category: params.category || 'General',
    subject: params.subject.trim(),
    priority: cleanPriority,
    status: 'OPEN',
    messages: [
      {
        senderType: 'MERCHANT',
        senderId: userObjId,
        message: params.message.trim(),
      },
    ],
  });

  await supportService.notifyListUpdate(userObjId.toString());

  setImmediate(async () => {
    try {
      const superAdmins = await User.find({ role: 'super_admin' }).select('_id').lean();
      for (const admin of superAdmins) {
        await notificationService.createNotification(
          admin._id.toString(),
          'TICKET_CREATED',
          'New Affiliate Support Ticket',
          `An affiliate partner created support ticket "${params.subject.trim()}".`,
          ticket._id
        );
      }
    } catch (e) {
      console.error('[AffiliateSupport] Notification error:', e);
    }
  });

  return ticket;
};

const getSupportTicketDetail = async (
  ticketId: string,
  affiliateId: string | Types.ObjectId,
  userId: string | Types.ObjectId
) => {
  if (!Types.ObjectId.isValid(ticketId)) {
    throw new CustomError(400, 'Invalid ticket ID');
  }
  const affObjId = new Types.ObjectId(affiliateId.toString());
  const userObjId = new Types.ObjectId(userId.toString());

  const ticket = await SupportTicket.findOne({
    _id: new Types.ObjectId(ticketId),
    $or: [{ affiliateId: affObjId }, { userId: userObjId }],
  })
    .populate('messages.senderId', 'name email role')
    .lean();

  if (!ticket) {
    throw new CustomError(404, 'Support ticket not found');
  }
  return ticket;
};

const replySupportTicket = async (params: {
  ticketId: string;
  affiliateId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
  message: string;
}) => {
  if (!Types.ObjectId.isValid(params.ticketId)) {
    throw new CustomError(400, 'Invalid ticket ID');
  }
  const affObjId = new Types.ObjectId(params.affiliateId.toString());
  const userObjId = new Types.ObjectId(params.userId.toString());

  const ticket = await SupportTicket.findOne({
    _id: new Types.ObjectId(params.ticketId),
    $or: [{ affiliateId: affObjId }, { userId: userObjId }],
  });

  if (!ticket) {
    throw new CustomError(404, 'Support ticket not found');
  }

  return await supportService.replyToTicket(
    params.ticketId,
    'MERCHANT',
    userObjId.toString(),
    params.message.trim()
  );
};

const updateSupportTicketStatus = async (params: {
  ticketId: string;
  affiliateId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
  status: 'OPEN' | 'RESOLVED' | 'CLOSED';
}) => {
  if (!Types.ObjectId.isValid(params.ticketId)) {
    throw new CustomError(400, 'Invalid ticket ID');
  }
  const affObjId = new Types.ObjectId(params.affiliateId.toString());
  const userObjId = new Types.ObjectId(params.userId.toString());

  const ticket = await SupportTicket.findOne({
    _id: new Types.ObjectId(params.ticketId),
    $or: [{ affiliateId: affObjId }, { userId: userObjId }],
  });

  if (!ticket) {
    throw new CustomError(404, 'Support ticket not found');
  }

  const updated = await supportService.updateTicketStatus(params.ticketId, params.status);
  return updated;
};

export const AffiliateService = {
  getPublicConfig,
  registerAffiliate,
  loginAffiliate,
  getMe,
  getOverview,
  updateProfile,
  changePassword,
  updatePaymentMethods,
  getLedgerTransactions,
  getSupportTickets,
  createSupportTicket,
  getSupportTicketDetail,
  replySupportTicket,
  updateSupportTicketStatus,
};

