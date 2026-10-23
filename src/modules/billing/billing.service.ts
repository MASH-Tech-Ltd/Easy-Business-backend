import { PlatformPaymentSettings, PlatformPaymentSubmission } from './billing.model';
import { IPlatformPaymentAccount } from './billing.interface';
import CustomError from '../../helpers/CustomError';
import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';
import { Addon } from '../addon/addon.model';
import { notificationService } from '../notification/notification.service';
import { User } from '../auth/auth.model';
import { paginationHelper } from '../../helpers/paginationHelper';
import { ReferralService } from '../referral/referral.service';
import { Package } from '../package/package.model';
import { SubscriptionService } from '../subscription/subscription.service';
import { sendEmail } from '../../utils/sendEmail';
import { paymentConfirmationTemplate } from '../../templates/paymentConfirmation';

const getPlatformPaymentSettings = async () => {
  let settings = await PlatformPaymentSettings.findOne();
  if (!settings) {
    // Default initial platform payment accounts if none configured yet
    settings = await PlatformPaymentSettings.create({
      accounts: [
        {
          id: 'bkash-1',
          provider: 'bKash',
          type: 'Merchant',
          accountNumber: '01700000000',
          accountName: 'MASH ECO Billing',
          instructions: 'Use bKash Merchant Payment (Make Payment option) or Send Money. Put your store domain as reference.',
          isActive: true,
        },
        {
          id: 'nagad-1',
          provider: 'Nagad',
          type: 'Personal',
          accountNumber: '01800000000',
          accountName: 'MASH ECO Accounts',
          instructions: 'Use Nagad Send Money. Put your store domain as reference.',
          isActive: true,
        },
        {
          id: 'bank-1',
          provider: 'Bank Transfer',
          type: 'Bank Account',
          accountNumber: '1234567890123',
          accountName: 'MASH TECH LIMITED',
          bankName: 'City Bank Ltd.',
          branchName: 'Gulshan Branch',
          instructions: 'Transfer to company bank account and upload TrxID / Deposit Slip.',
          isActive: true,
        },
      ],
      gatewaySettings: {
        sslCommerzEnabled: false,
        bKashCheckoutEnabled: false,
        stripeEnabled: false,
      },
    });
  }
  return settings;
};

const updatePlatformPaymentSettings = async (payload: { accounts?: IPlatformPaymentAccount[]; gatewaySettings?: any }) => {
  let settings = await PlatformPaymentSettings.findOne();
  if (!settings) {
    settings = new PlatformPaymentSettings();
  }
  if (payload.accounts) settings.accounts = payload.accounts;
  if (payload.gatewaySettings) settings.gatewaySettings = payload.gatewaySettings;
  await settings.save();
  return settings;
};

const submitPaymentProof = async (tenantId: string, payload: {
  purpose: 'addon' | 'package' | 'renewal' | 'other';
  purposeTitle: string;
  amount: number;
  provider: string;
  senderNumber: string;
  transactionId: string;
  note?: string;
}) => {
  if (!payload.transactionId || !payload.amount || !payload.provider || !payload.senderNumber) {
    throw new CustomError(400, 'Please fill in all required payment details');
  }

  const existingTrx = await PlatformPaymentSubmission.findOne({ transactionId: payload.transactionId.trim() });
  if (existingTrx) {
    throw new CustomError(400, 'This Transaction ID (TrxID) has already been submitted');
  }

  // Backend verification of amount for subscription packages
  if (payload.purpose === 'package' || payload.purpose === 'renewal') {
    const tenant = await Tenant.findById(tenantId);
    // Find matching package by purposeTitle
    const cleanTitle = (payload.purposeTitle || '').trim().toLowerCase();
    const pkg = await Package.findOne({
      $or: [
        { name: { $regex: new RegExp(`^${cleanTitle}$`, 'i') } },
        { name: cleanTitle }
      ]
    });

    if (pkg) {
      let expectedPrice = pkg.price;

      // Apply first-time referral discount if tenant has an unused discount
      if (
        tenant?.referralDiscount &&
        !tenant.referralDiscount.used &&
        tenant.referralDiscount.discountValue > 0
      ) {
        if (tenant.referralDiscount.discountType === 'percentage') {
          const discountAmt = Math.round((expectedPrice * tenant.referralDiscount.discountValue) / 100);
          expectedPrice = Math.max(0, expectedPrice - discountAmt);
        } else if (tenant.referralDiscount.discountType === 'fixed') {
          expectedPrice = Math.max(0, expectedPrice - tenant.referralDiscount.discountValue);
        }
      }

      // If merchant sent significantly less than the discounted expected price, reject
      if (Number(payload.amount) < expectedPrice) {
        throw new CustomError(
          400,
          `Invalid payment amount: ৳${payload.amount}. The required amount for plan "${pkg.name}" is ৳${expectedPrice}.`
        );
      }
    }
  }

  const submissionData: any = {
    tenantId,
    purpose: payload.purpose || 'addon',
    purposeTitle: payload.purposeTitle || 'Platform Payment',
    amount: payload.amount,
    provider: payload.provider,
    senderNumber: payload.senderNumber,
    transactionId: payload.transactionId.trim(),
    status: 'pending',
  };
  if (payload.note) {
    submissionData.note = payload.note;
  }

  const submission: any = await PlatformPaymentSubmission.create(submissionData);

  const tenant = await Tenant.findById(tenantId);
  const superAdmins = await User.find({ role: 'super_admin' });
  for (const admin of superAdmins) {
    await notificationService.createNotification(
      admin._id,
      'PAYMENT_SUBMITTED',
      'New Payment Submitted',
      `Store ${tenant?.name || tenant?.domain} submitted ৳${payload.amount} via ${payload.provider} (TrxID: ${payload.transactionId}).`,
      submission._id,
      tenantId
    );
  }

  return submission;
};

const getMyPaymentSubmissions = async (tenantId: string) => {
  return PlatformPaymentSubmission.find({ tenantId }).sort({ createdAt: -1 }).lean();
};

const getAllPaymentSubmissions = async (query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, status, provider, year, month, startDate, endDate } = query || {};

  const filter: any = {};
  if (status && status !== 'all') {
    filter.status = status;
  }
  if (provider && provider !== 'all') {
    filter.provider = { $regex: new RegExp(`^${provider}$`, 'i') };
  }

  let dateStart: Date | null = null;
  let dateEnd: Date | null = null;
  let filteredPeriodLabel = '';

  if (startDate && endDate) {
    dateStart = new Date(startDate);
    dateStart.setHours(0, 0, 0, 0);
    dateEnd = new Date(endDate);
    dateEnd.setHours(23, 59, 59, 999);
    filteredPeriodLabel = `${startDate} to ${endDate}`;
  } else if (year && year !== 'all') {
    const numYear = parseInt(year);
    if (month && month !== 'all') {
      const numMonth = parseInt(month);
      dateStart = new Date(numYear, numMonth - 1, 1, 0, 0, 0, 0);
      dateEnd = new Date(numYear, numMonth, 0, 23, 59, 59, 999);
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      filteredPeriodLabel = `${monthNames[numMonth - 1]} ${numYear}`;
    } else {
      dateStart = new Date(numYear, 0, 1, 0, 0, 0, 0);
      dateEnd = new Date(numYear, 11, 31, 23, 59, 59, 999);
      filteredPeriodLabel = `Year ${numYear}`;
    }
  }

  if (dateStart && dateEnd) {
    filter.createdAt = { $gte: dateStart, $lte: dateEnd };
  }

  if (search) {
    const searchRegex = { $regex: search, $options: 'i' };
    const matchingTenants = await Tenant.find({
      $or: [{ name: searchRegex }, { domain: searchRegex }],
    }).select('_id').lean();
    const matchingTenantIds = matchingTenants.map((t) => t._id);

    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { transactionId: searchRegex },
        { senderNumber: searchRegex },
        { purposeTitle: searchRegex },
        { tenantId: { $in: matchingTenantIds } },
      ],
    });
  }

  const [allSubmissions, data, total] = await Promise.all([
    PlatformPaymentSubmission.find().populate('tenantId', 'name domain slug').lean(),
    PlatformPaymentSubmission.find(filter)
      .populate({
        path: 'tenantId',
        select: 'name domain slug customDomain domainStatus contactEmail ownerId',
        populate: { path: 'ownerId', select: 'name email phone' },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PlatformPaymentSubmission.countDocuments(filter),
  ]);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let approvedRevenue = 0;
  let pendingRevenue = 0;
  let thisMonthRevenue = 0;
  let thisYearRevenue = 0;

  let filteredCount = 0;
  let filteredApprovedCount = 0;
  let filteredPendingCount = 0;
  let filteredApprovedRevenue = 0;
  let filteredPendingRevenue = 0;

  allSubmissions.forEach((p: any) => {
    const amt = Number(p.amount || 0);
    const pDate = new Date(p.createdAt);

    if (p.status === 'approved') {
      approvedRevenue += amt;
      if (pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) {
        thisMonthRevenue += amt;
      }
      if (pDate.getFullYear() === currentYear) {
        thisYearRevenue += amt;
      }
    } else if (p.status === 'pending') {
      pendingRevenue += amt;
    }

    if (dateStart && dateEnd && pDate >= dateStart && pDate <= dateEnd) {
      filteredCount += 1;
      if (p.status === 'approved') {
        filteredApprovedCount += 1;
        filteredApprovedRevenue += amt;
      } else if (p.status === 'pending') {
        filteredPendingCount += 1;
        filteredPendingRevenue += amt;
      }
    }
  });

    const validSubmissionsList = allSubmissions.filter((p: any) => p.status !== 'rejected');
    const rejectedSubmissionsList = allSubmissions.filter((p: any) => p.status === 'rejected');

    const stats = {
      totalCount: validSubmissionsList.length, // Don't count rejected in total
      allSubmissionsCount: allSubmissions.length,
      validCount: validSubmissionsList.length,
      pendingCount: allSubmissions.filter((p: any) => p.status === 'pending').length,
      approvedCount: allSubmissions.filter((p: any) => p.status === 'approved').length,
      rejectedCount: rejectedSubmissionsList.length,
      approvedRevenue,
      pendingRevenue,
      thisMonthRevenue,
      thisYearRevenue,
      hasFilter: Boolean(dateStart && dateEnd),
      filteredPeriodLabel,
      filteredCount: filteredApprovedCount + filteredPendingCount, // Exclude rejected from filtered total
      allFilteredCount: filteredCount,
      filteredApprovedCount,
      filteredPendingCount,
      filteredApprovedRevenue,
      filteredPendingRevenue,
    };

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
    stats,
  };
};

const getPaymentProofsReport = async (query: any) => {
  const { type, year, month, startDate, endDate, status, provider } = query || {};

  const filter: any = {};
  if (status && status !== 'all') {
    filter.status = status;
  }
  if (provider && provider !== 'all') {
    filter.provider = { $regex: new RegExp(`^${provider}$`, 'i') };
  }

  let filterStart: Date | null = null;
  let filterEnd: Date | null = null;
  let periodLabel = 'All Time';

  if (type === 'custom' && startDate && endDate) {
    filterStart = new Date(startDate);
    filterStart.setHours(0, 0, 0, 0);
    filterEnd = new Date(endDate);
    filterEnd.setHours(23, 59, 59, 999);
    periodLabel = `${startDate} to ${endDate}`;
  } else if (type === 'monthly' && year && month && month !== 'all' && year !== 'all') {
    const numYear = parseInt(year);
    const numMonth = parseInt(month);
    filterStart = new Date(numYear, numMonth - 1, 1, 0, 0, 0, 0);
    filterEnd = new Date(numYear, numMonth, 0, 23, 59, 59, 999);
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    periodLabel = `${monthNames[numMonth - 1]} ${numYear}`;
  } else if (type === 'yearly' && year && year !== 'all') {
    const numYear = parseInt(year);
    filterStart = new Date(numYear, 0, 1, 0, 0, 0, 0);
    filterEnd = new Date(numYear, 11, 31, 23, 59, 59, 999);
    periodLabel = `Year ${numYear}`;
  } else if (startDate && endDate) {
    filterStart = new Date(startDate);
    filterStart.setHours(0, 0, 0, 0);
    filterEnd = new Date(endDate);
    filterEnd.setHours(23, 59, 59, 999);
    periodLabel = `${startDate} to ${endDate}`;
  } else if (year && year !== 'all') {
    const numYear = parseInt(year);
    if (month && month !== 'all') {
      const numMonth = parseInt(month);
      filterStart = new Date(numYear, numMonth - 1, 1, 0, 0, 0, 0);
      filterEnd = new Date(numYear, numMonth, 0, 23, 59, 59, 999);
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      periodLabel = `${monthNames[numMonth - 1]} ${numYear}`;
    } else {
      filterStart = new Date(numYear, 0, 1, 0, 0, 0, 0);
      filterEnd = new Date(numYear, 11, 31, 23, 59, 59, 999);
      periodLabel = `Year ${numYear}`;
    }
  }

  if (filterStart && filterEnd) {
    filter.createdAt = { $gte: filterStart, $lte: filterEnd };
  }

  const submissions = await PlatformPaymentSubmission.find(filter)
    .populate('tenantId', 'name domain slug customDomain')
    .sort({ createdAt: -1 })
    .lean();

  let totalRevenue = 0;
  let totalPending = 0;
  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;

  const items = submissions.map((p: any, idx: number) => {
    const amt = Number(p.amount || 0);
    const tenant = p.tenantId || {};

    if (p.status === 'approved') {
      totalRevenue += amt;
      approvedCount += 1;
    } else if (p.status === 'pending') {
      totalPending += amt;
      pendingCount += 1;
    } else if (p.status === 'rejected') {
      rejectedCount += 1;
    }

    return {
      sl: idx + 1,
      _id: p._id,
      date: p.createdAt,
      tenantName: tenant.name || 'Unknown Store',
      tenantDomain: tenant.domain || 'N/A',
      purpose: p.purposeTitle || (p.purpose ? p.purpose.toUpperCase() : 'SUBSCRIPTION'),
      provider: p.provider || 'N/A',
      transactionId: p.transactionId || 'N/A',
      senderNumber: p.senderNumber || 'N/A',
      amount: amt,
      status: p.status,
      adminFeedback: p.adminFeedback || '-',
    };
  });

  return {
    summary: {
      reportType: type || 'all',
      periodLabel,
      totalRevenue,
      totalPending,
      totalSubmissions: items.length,
      validSubmissions: approvedCount + pendingCount,
      approvedCount,
      pendingCount,
      rejectedCount,
      generatedAt: new Date().toISOString(),
      currency: 'BDT',
    },
    items,
  };
};

const verifyPaymentSubmission = async (id: string, status: 'approved' | 'rejected', adminFeedback?: string) => {
  const submission = await PlatformPaymentSubmission.findById(id);
  if (!submission) throw new CustomError(404, 'Payment submission not found');

  submission.status = status;
  if (adminFeedback) submission.adminFeedback = adminFeedback;
  await submission.save();

  // If this payment submission was for an addon, sync the purchasedAddons array in the tenant's Subscription
  if (submission.purpose === 'addon' && submission.tenantId) {
    const subscriptions = await Subscription.find({
      tenantId: submission.tenantId,
    }).populate('purchasedAddons.addonId');

    for (const subscription of subscriptions) {
      if (!subscription.purchasedAddons) continue;
      let modified = false;

      for (const pa of subscription.purchasedAddons as any[]) {
        const addonName = pa.addonId?.name || '';
        const addonIdStr = pa.addonId?._id?.toString() || pa.addonId?.toString() || '';
        const purposeTitleLower = (submission.purposeTitle || '').trim().toLowerCase();
        const addonNameLower = addonName.trim().toLowerCase();

        const matchesName =
          purposeTitleLower &&
          (addonNameLower === purposeTitleLower ||
           purposeTitleLower.includes(addonNameLower) ||
           addonNameLower.includes(purposeTitleLower) ||
           addonIdStr === purposeTitleLower);

        if (matchesName) {
          if (status === 'approved') {
            pa.status = 'active';
            pa.isActive = true;
            if (pa.used >= pa.limit && pa.limit > 0) {
              const addonDoc: any = pa.addonId;
              pa.limit += addonDoc?.defaultLimit || 50;
            }
          } else if (status === 'rejected') {
            pa.status = 'rejected';
            pa.isActive = false;
          }
          modified = true;
        }
      }

      if (modified) {
        await subscription.save();
      }
    }
  }

  // If subscription/package/renewal payment is verified and approved, unlock referrer points & mark first-time discount as used
  if (status === 'approved' && (submission.purpose === 'package' || submission.purpose === 'renewal') && submission.tenantId) {
    let pendingSubApproved = false;

    // Automatically approve related pending subscription for this tenant
    try {
      let pendingSub = null;
      if (submission.purposeTitle) {
        const allPendingSubs = await Subscription.find({
          tenantId: submission.tenantId,
          status: 'pending',
        }).populate('packageId').sort({ createdAt: -1 });

        const titleLower = submission.purposeTitle.trim().toLowerCase();
        pendingSub = allPendingSubs.find((sub: any) => {
          const pkgName = (sub.packageId?.name || '').trim().toLowerCase();
          return pkgName && (titleLower.includes(pkgName) || pkgName.includes(titleLower));
        }) || allPendingSubs[0];
      } else {
        pendingSub = await Subscription.findOne({
          tenantId: submission.tenantId,
          status: 'pending',
        }).populate('packageId').sort({ createdAt: -1 });
      }

      if (pendingSub) {
        await SubscriptionService.approveSubscription(pendingSub._id.toString());
        pendingSubApproved = true;
      }
    } catch (err) {
      console.error('Failed to auto-approve related subscription on payment verification:', err);
    }

    // If there was no pending subscription to approve, trigger referral unlock directly
    if (!pendingSubApproved) {
      try {
        await ReferralService.unlockReferralPointsForSubscription(submission.tenantId.toString());
      } catch (err) {
        console.error('Failed to unlock referral points upon payment verification fallback:', err);
      }
    }

    // Mark referral discount as used
    try {
      await Tenant.findByIdAndUpdate(submission.tenantId, {
        $set: { 'referralDiscount.used': true },
      });
    } catch (err) {
      console.error('Failed to mark referral discount used:', err);
    }
  }

  // If subscription/package/renewal payment is rejected, also reject any pending subscription request for this tenant
  if (status === 'rejected' && (submission.purpose === 'package' || submission.purpose === 'renewal') && submission.tenantId) {
    try {
      const pendingSub = await Subscription.findOne({
        tenantId: submission.tenantId,
        status: 'pending',
      }).sort({ createdAt: -1 });

      if (pendingSub) {
        await SubscriptionService.rejectSubscription(pendingSub._id.toString());
      }
    } catch (err) {
      console.error('Failed to auto-reject related subscription on payment rejection:', err);
    }
  }

  const tenant = await Tenant.findById(submission.tenantId);
  if (tenant && tenant.ownerId) {
    await notificationService.createNotification(
      tenant.ownerId,
      status === 'approved' ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
      status === 'approved' ? 'Payment Verified' : 'Payment Verification Rejected',
      `Your payment of ৳${submission.amount} (TrxID: ${submission.transactionId}) has been ${status}. ${adminFeedback ? 'Note: ' + adminFeedback : ''}`,
      submission._id,
      submission.tenantId
    );
  }

  try {
    const io = require('../../socket').getIO();
    if (tenant && tenant.ownerId) {
      io.to('user_' + tenant.ownerId.toString()).emit('refresh_subscriptions');
    }
    if (submission.tenantId) {
      io.to('tenant_' + submission.tenantId.toString()).emit('refresh_subscriptions');
    }
    const superAdmins = await User.find({ role: 'super_admin' });
    for (const admin of superAdmins) {
      io.to('user_' + admin._id.toString()).emit('refresh_subscriptions');
    }
  } catch (error) {}

  return submission;
};

const updateMyPaymentSubmission = async (
  tenantId: string,
  id: string,
  payload: {
    purposeTitle?: string;
    amount?: number;
    provider?: string;
    senderNumber?: string;
    transactionId?: string;
    note?: string;
  }
) => {
  const submission = await PlatformPaymentSubmission.findOne({ _id: id, tenantId });
  if (!submission) {
    throw new CustomError(404, 'Payment submission not found');
  }

  if (submission.status !== 'pending') {
    throw new CustomError(400, 'Cannot edit payment proof after it has been processed by admin');
  }

  if (payload.transactionId && payload.transactionId.trim() !== submission.transactionId) {
    const existing = await PlatformPaymentSubmission.findOne({
      transactionId: payload.transactionId.trim(),
      _id: { $ne: id },
    });
    if (existing) {
      throw new CustomError(400, 'This Transaction ID (TrxID) is already in use');
    }
    submission.transactionId = payload.transactionId.trim();
  }

  if (payload.senderNumber) submission.senderNumber = payload.senderNumber;
  if (payload.provider) submission.provider = payload.provider;
  if (payload.amount) submission.amount = payload.amount;
  if (payload.purposeTitle) submission.purposeTitle = payload.purposeTitle;
  if (payload.note !== undefined) submission.note = payload.note;

  await submission.save();
  return submission;
};

const deletePaymentSubmission = async (id: string) => {
  const submission = await PlatformPaymentSubmission.findById(id);
  if (!submission) {
    throw new CustomError(404, 'Payment submission not found');
  }

  await PlatformPaymentSubmission.findByIdAndDelete(id);

  try {
    const io = require('../../socket').getIO();
    io.emit('refresh_subscriptions');
  } catch (error) {}

  return { success: true, message: 'Payment submission deleted successfully' };
};

const sendPaymentConfirmationEmail = async (id: string) => {
  const submission = await PlatformPaymentSubmission.findById(id).populate({
    path: 'tenantId',
    populate: { path: 'ownerId', select: 'name email phone' },
  });

  if (!submission) {
    throw new CustomError(404, 'Payment submission not found');
  }

  if (submission.status !== 'approved') {
    throw new CustomError(400, 'Confirmation email can only be sent for approved payments');
  }

  const tenant: any = submission.tenantId;
  const recipientEmail = tenant?.contactEmail || tenant?.ownerId?.email;

  if (!recipientEmail || !recipientEmail.includes('@')) {
    throw new CustomError(400, 'No contact email or store owner email found for this merchant');
  }

  const storeName = tenant?.name || 'Your Store';
  const ownerName = tenant?.ownerId?.name || tenant?.name || 'মার্চেন্ট';

  const emailHtml = paymentConfirmationTemplate({
    storeName,
    ownerName,
    purposeTitle: submission.purposeTitle || (submission.purpose ? submission.purpose.toUpperCase() : 'Subscription / Package'),
    amount: submission.amount,
    provider: submission.provider,
    senderNumber: submission.senderNumber,
    transactionId: submission.transactionId,
    approvalDate: submission.updatedAt || submission.createdAt,
    adminFeedback: submission.adminFeedback,
  });

  await sendEmail(
    recipientEmail,
    `পেমেন্ট নিশ্চিতকরণ: ${storeName} - ৳${submission.amount} অনুমোদিত হয়েছে (MASH ECO)`,
    emailHtml
  );

  submission.confirmationEmailSentCount = (submission.confirmationEmailSentCount || 0) + 1;
  submission.lastConfirmationEmailSentAt = new Date();
  await submission.save();

  try {
    const io = require('../../socket').getIO();
    io.emit('refresh_subscriptions');
  } catch (error) {}

  return {
    success: true,
    sentTo: recipientEmail,
    sentCount: submission.confirmationEmailSentCount,
    lastSentAt: submission.lastConfirmationEmailSentAt,
    submission,
  };
};

export const BillingService = {
  getPlatformPaymentSettings,
  updatePlatformPaymentSettings,
  submitPaymentProof,
  getMyPaymentSubmissions,
  updateMyPaymentSubmission,
  getAllPaymentSubmissions,
  getPaymentProofsReport,
  verifyPaymentSubmission,
  deletePaymentSubmission,
  sendPaymentConfirmationEmail,
};


