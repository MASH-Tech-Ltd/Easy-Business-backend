import { PlatformPaymentSettings, PlatformPaymentSubmission } from './billing.model';
import { IPlatformPaymentAccount } from './billing.interface';
import CustomError from '../../helpers/CustomError';
import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';
import { Addon } from '../addon/addon.model';
import { notificationService } from '../notification/notification.service';
import { User } from '../auth/auth.model';
import { paginationHelper } from '../../helpers/paginationHelper';

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
  const { search, status, provider } = query || {};

  const filter: any = {};
  if (status && status !== 'all') {
    filter.status = status;
  }
  if (provider && provider !== 'all') {
    filter.provider = { $regex: new RegExp(`^${provider}$`, 'i') };
  }

  if (search) {
    const searchRegex = { $regex: search, $options: 'i' };
    const matchingTenants = await Tenant.find({
      $or: [{ name: searchRegex }, { domain: searchRegex }],
    }).select('_id').lean();
    const matchingTenantIds = matchingTenants.map((t) => t._id);

    filter.$or = [
      { transactionId: searchRegex },
      { senderNumber: searchRegex },
      { purposeTitle: searchRegex },
      { tenantId: { $in: matchingTenantIds } },
    ];
  }

  const [allSubmissions, data, total] = await Promise.all([
    PlatformPaymentSubmission.find().lean(),
    PlatformPaymentSubmission.find(filter)
      .populate('tenantId', 'name domain slug customDomain domainStatus')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PlatformPaymentSubmission.countDocuments(filter),
  ]);

  const stats = {
    totalCount: allSubmissions.length,
    pendingCount: allSubmissions.filter((p) => p.status === 'pending').length,
    approvedCount: allSubmissions.filter((p) => p.status === 'approved').length,
    rejectedCount: allSubmissions.filter((p) => p.status === 'rejected').length,
    approvedRevenue: allSubmissions
      .filter((p) => p.status === 'approved')
      .reduce((sum, p) => sum + (p.amount || 0), 0),
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

export const BillingService = {
  getPlatformPaymentSettings,
  updatePlatformPaymentSettings,
  submitPaymentProof,
  getMyPaymentSubmissions,
  updateMyPaymentSubmission,
  getAllPaymentSubmissions,
  verifyPaymentSubmission,
};

