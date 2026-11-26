import axios from 'axios';
import { Types } from 'mongoose';
import config from '../../config';
import CustomError from '../../helpers/CustomError';
import { isMerchantOnline } from '../../socket';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../auth/auth.model';
import { Subscription } from '../subscription/subscription.model';
import { Addon } from '../addon/addon.model';
import { SmsLog, SmsTriggerType } from './smsLog.model';

/** Converts 01XXXXXXXXX / +8801XXXXXXXXX / 8801XXXXXXXXX to 8801XXXXXXXXX for BulkSMSBD. */
export const formatBDNumberForSms = (phone?: string | null): string | null => {
  const digits = String(phone || '').replace(/[\s\-()]/g, '').trim();
  if (!digits) return null;
  let formatted = digits;
  if (formatted.startsWith('+880')) formatted = formatted.slice(1);
  else if (formatted.startsWith('01')) formatted = `88${formatted}`;
  return /^8801[3-9]\d{8}$/.test(formatted) ? formatted : null;
};

export interface SendSmsInput {
  phone: string;
  message: string;
  tenantId?: string | null;
  orderId?: string | null;
  triggerType: SmsTriggerType;
  sentBy?: string | null;
}

const sendSingleSms = async (input: SendSmsInput) => {
  const formattedPhone = formatBDNumberForSms(input.phone);
  if (!formattedPhone) {
    throw new CustomError(400, `Invalid Bangladeshi mobile number: ${input.phone}`);
  }

  const trimmedMsg = String(input.message || '').trim();
  if (!trimmedMsg) {
    throw new CustomError(400, 'SMS message cannot be empty');
  }

  if (!config.sms.apiKey) {
    throw new CustomError(500, 'BulkSMSBD API key is not configured');
  }

  const params = new URLSearchParams({
    api_key: config.sms.apiKey,
    type: 'text',
    number: formattedPhone,
    senderid: config.sms.senderId,
    message: trimmedMsg,
  });

  let status: 'sent' | 'failed' = 'failed';
  let providerCode: number | null = null;
  let providerMessage = '';

  try {
    const res = await axios.post(`${config.sms.baseUrl}/smsapi`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const data = res.data || {};
    providerCode = typeof data.response_code === 'number' ? data.response_code : Number(data.response_code) || null;
    providerMessage = String(data.success_message || data.error_message || JSON.stringify(data)).slice(0, 300);
    // BulkSMSBD returns response_code 202 on successful submission
    if (providerCode === 202 || providerCode === 200) {
      status = 'sent';
    }
  } catch (error: any) {
    providerMessage = String(error?.message || 'SMS request failed').slice(0, 300);
  }

  const log = await SmsLog.create({
    tenantId: input.tenantId && Types.ObjectId.isValid(input.tenantId) ? new Types.ObjectId(input.tenantId) : null,
    orderId: input.orderId && Types.ObjectId.isValid(input.orderId) ? new Types.ObjectId(input.orderId) : null,
    phone: formattedPhone,
    message: trimmedMsg,
    triggerType: input.triggerType,
    status,
    providerCode,
    providerMessage,
    sentBy: input.sentBy && Types.ObjectId.isValid(input.sentBy) ? new Types.ObjectId(input.sentBy) : null,
  });

  return log;
};

const getCreditBalance = async () => {
  if (!config.sms.apiKey) {
    return { configured: false, balance: null, message: 'BULKSMSBD_API_KEY not configured' };
  }
  const url = `${config.sms.baseUrl}/getBalanceApi?api_key=${encodeURIComponent(config.sms.apiKey)}`;
  const res = await axios.get(url, { timeout: 10000 });
  const data = res.data || {};
  const balance = data.balance !== undefined ? Number(data.balance) : null;
  return {
    configured: true,
    enabled: config.sms.enabled,
    senderId: config.sms.senderId,
    balance: Number.isFinite(balance) ? balance : null,
    responseCode: data.response_code ?? null,
    message: data.error_message || data.success_message || 'OK',
  };
};

const SMS_ADDON_SLUGS = ['new_order_sms_alert', 'new-order-sms-alert', 'sms_notifications', 'sms-notifications'];

export const hasRemainingSmsAddonQuota = (entry?: { limit?: number; used?: number } | null): boolean => {
  if (!entry) return false;
  const limit = Number(entry.limit) || 0;
  const used = Number(entry.used) || 0;
  return limit > 0 && used < limit;
};

/**
 * Sends an SMS to the merchant when a new order arrives AND:
 *   1. The merchant is offline (no active Socket.io connection)
 *   2. The merchant has an active `new_order_sms_alert` (or `sms_notifications`) add-on with remaining quota (`used < limit`)
 * Increments the add-on's `used` counter upon successful submission. Never throws.
 */
const notifyOfflineMerchantOnNewOrder = async (opts: {
  tenantId: string;
  orderId: string;
  customerName: string;
  totalPrice: number;
  tenantAdminId?: string | null;
}) => {
  if (!config.sms.enabled || !config.sms.apiKey) {
    return { sent: false, reason: 'sms_disabled' };
  }

  if (isMerchantOnline(opts.tenantId, opts.tenantAdminId)) {
    return { sent: false, reason: 'merchant_online' };
  }

  const smsAddons = await Addon.find({ slug: { $in: SMS_ADDON_SLUGS } }).select('_id').lean();
  if (!smsAddons || smsAddons.length === 0) {
    return { sent: false, reason: 'sms_addon_not_defined' };
  }
  const smsAddonIds = smsAddons.map((a) => a._id);
  const smsAddonIdSet = new Set(smsAddonIds.map((id) => id.toString()));

  const activeSub = await Subscription.findOne({
    tenantId: new Types.ObjectId(opts.tenantId),
    status: 'active',
    'purchasedAddons.addonId': { $in: smsAddonIds },
  })
    .select('_id purchasedAddons')
    .lean();

  const addonEntry = activeSub?.purchasedAddons?.find(
    (pa: any) => pa.addonId && smsAddonIdSet.has(pa.addonId.toString()) && hasRemainingSmsAddonQuota(pa),
  );

  if (!addonEntry) {
    return { sent: false, reason: 'addon_not_active_or_quota_exceeded' };
  }
  const matchedAddonId = (addonEntry as any).addonId;

  const [tenant, adminUser] = await Promise.all([
    Tenant.findById(opts.tenantId).select('name contactPhone').lean(),
    opts.tenantAdminId
      ? User.findById(opts.tenantAdminId).select('phone').lean()
      : User.findOne({ tenantId: opts.tenantId, role: 'tenant_admin' }).select('phone').lean(),
  ]);

  const rawPhone = tenant?.contactPhone || adminUser?.phone || '';
  const formatted = formatBDNumberForSms(rawPhone);
  if (!formatted) {
    return { sent: false, reason: 'no_valid_merchant_phone' };
  }

  const shortOrder = String(opts.orderId).slice(-6).toUpperCase();
  const storeName = (tenant?.name || 'MASH ECO').slice(0, 30);
  const message = `Apnar notun order eseche (#${shortOrder}) - ${opts.customerName}, ${opts.totalPrice} BDT on ${storeName}. Check MASH ECO dashboard.`;

  const log = await sendSingleSms({
    phone: formatted,
    message,
    tenantId: opts.tenantId,
    orderId: opts.orderId,
    triggerType: 'new_order_offline',
  });

  if (log.status === 'sent' && activeSub) {
    await Subscription.updateOne(
      { _id: activeSub._id, 'purchasedAddons.addonId': matchedAddonId },
      { $inc: { 'purchasedAddons.$.used': 1, 'purchasedAddons.$.paidUsed': 1 } },
    ).catch((err) => console.error('[SMS] Failed to increment sms addon usage:', err));
  }

  return { sent: log.status === 'sent', status: log.status, logId: log._id };
};

const sendManualAdminSms = async (opts: {
  adminUserId: string;
  message: string;
  tenantIds?: string[];
  phone?: string;
}) => {
  if (!config.sms.apiKey) {
    throw new CustomError(400, 'BulkSMSBD API key is not configured on the server');
  }

  const targets: Array<{ phone: string; tenantId: string | null; storeName?: string }> = [];

  if (Array.isArray(opts.tenantIds) && opts.tenantIds.length > 0) {
    const validIds = opts.tenantIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const [tenants, admins] = await Promise.all([
      Tenant.find({ _id: { $in: validIds } }).select('name contactPhone').lean(),
      User.find({ tenantId: { $in: validIds }, role: 'tenant_admin' }).select('tenantId phone').lean(),
    ]);
    const adminPhoneByTenant = new Map(admins.map((u: any) => [u.tenantId?.toString(), u.phone]));
    for (const t of tenants as any[]) {
      const p = t.contactPhone || adminPhoneByTenant.get(t._id.toString()) || '';
      if (p) {
        targets.push({ phone: p, tenantId: t._id.toString(), storeName: t.name });
      }
    }
  }

  if (opts.phone && opts.phone.trim()) {
    targets.push({ phone: opts.phone.trim(), tenantId: null });
  }

  if (targets.length === 0) {
    throw new CustomError(400, 'No valid merchant phone or direct phone number provided');
  }

  const results = [];
  for (const t of targets) {
    const log = await sendSingleSms({
      phone: t.phone,
      message: opts.message,
      tenantId: t.tenantId,
      triggerType: 'admin_manual',
      sentBy: opts.adminUserId,
    });
    results.push({ ...log.toObject(), storeName: t.storeName || null });
  }

  return {
    totalRequested: targets.length,
    sentCount: results.filter((r) => r.status === 'sent').length,
    failedCount: results.filter((r) => r.status === 'failed').length,
    results,
  };
};

const getSmsSummaryAndLogs = async (query: { page?: string; limit?: string; tenantId?: string; triggerType?: string }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: any = {};
  if (query.tenantId && Types.ObjectId.isValid(query.tenantId)) {
    filter.tenantId = new Types.ObjectId(query.tenantId);
  }
  if (query.triggerType && ['new_order_offline', 'admin_manual'].includes(query.triggerType)) {
    filter.triggerType = query.triggerType;
  }

  const [logs, total, countsAgg, perMerchantAgg] = await Promise.all([
    SmsLog.find(filter)
      .populate('tenantId', 'name slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SmsLog.countDocuments(filter),
    SmsLog.aggregate([
      {
        $group: {
          _id: { triggerType: '$triggerType', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]),
    SmsLog.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$tenantId',
          totalSent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          orderOfflineSent: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$triggerType', 'new_order_offline'] }, { $eq: ['$status', 'sent'] }] },
                1,
                0,
              ],
            },
          },
          adminManualSent: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$triggerType', 'admin_manual'] }, { $eq: ['$status', 'sent'] }] },
                1,
                0,
              ],
            },
          },
          lastNotifiedAt: { $max: '$createdAt' },
        },
      },
      { $sort: { lastNotifiedAt: -1 } },
      { $limit: 50 },
    ]),
  ]);

  let totalSent = 0;
  let totalFailed = 0;
  let orderOfflineSent = 0;
  let adminManualSent = 0;
  for (const c of countsAgg) {
    if (c._id.status === 'sent') {
      totalSent += c.count;
      if (c._id.triggerType === 'new_order_offline') orderOfflineSent += c.count;
      if (c._id.triggerType === 'admin_manual') adminManualSent += c.count;
    } else {
      totalFailed += c.count;
    }
  }

  const merchantIds = perMerchantAgg.map((m) => m._id);
  const tenants = merchantIds.length
    ? await Tenant.find({ _id: { $in: merchantIds } }).select('name slug contactPhone').lean()
    : [];
  const tenantMap = new Map(tenants.map((t: any) => [t._id.toString(), t]));

  const merchantStats = perMerchantAgg.map((m) => {
    const t: any = tenantMap.get(m._id.toString());
    return {
      tenantId: m._id.toString(),
      storeName: t?.name || 'Unknown Store',
      slug: t?.slug || '',
      contactPhone: t?.contactPhone || '',
      totalSent: m.totalSent,
      totalFailed: m.totalFailed,
      orderOfflineSent: m.orderOfflineSent,
      adminManualSent: m.adminManualSent,
      lastNotifiedAt: m.lastNotifiedAt,
    };
  });

  return {
    summary: {
      totalSent,
      totalFailed,
      orderOfflineSent,
      adminManualSent,
    },
    merchantStats,
    logs,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getMerchantSmsStats = async (tenantId: string) => {
  const tid = new Types.ObjectId(tenantId);
  const [counts, recentLogs] = await Promise.all([
    SmsLog.aggregate([
      { $match: { tenantId: tid } },
      {
        $group: {
          _id: { triggerType: '$triggerType', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]),
    SmsLog.find({ tenantId: tid }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  let totalSent = 0;
  let orderOfflineSent = 0;
  let adminManualSent = 0;
  for (const c of counts) {
    if (c._id.status === 'sent') {
      totalSent += c.count;
      if (c._id.triggerType === 'new_order_offline') orderOfflineSent += c.count;
      if (c._id.triggerType === 'admin_manual') adminManualSent += c.count;
    }
  }

  return { totalSent, orderOfflineSent, adminManualSent, recentLogs };
};

const resendSmsLog = async (logId: string, adminUserId: string) => {
  if (!Types.ObjectId.isValid(logId)) {
    throw new CustomError(400, 'Invalid SMS log ID');
  }
  const existing = await SmsLog.findById(logId);
  if (!existing) {
    throw new CustomError(404, 'SMS log not found');
  }
  if (!config.sms.apiKey) {
    throw new CustomError(400, 'BulkSMSBD API key is not configured on the server');
  }

  const params = new URLSearchParams({
    api_key: config.sms.apiKey,
    type: 'text',
    number: existing.phone,
    senderid: config.sms.senderId,
    message: existing.message,
  });

  let status: 'sent' | 'failed' = 'failed';
  let providerCode: number | null = null;
  let providerMessage = '';

  try {
    const res = await axios.post(`${config.sms.baseUrl}/smsapi`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const data = res.data || {};
    providerCode = typeof data.response_code === 'number' ? data.response_code : Number(data.response_code) || null;
    providerMessage = String(data.success_message || data.error_message || JSON.stringify(data)).slice(0, 300);
    if (providerCode === 202 || providerCode === 200) {
      status = 'sent';
    }
  } catch (error: any) {
    providerMessage = String(error?.message || 'SMS resend failed').slice(0, 300);
  }

  existing.status = status;
  existing.providerCode = providerCode;
  existing.providerMessage = providerMessage;
  if (!existing.sentBy && Types.ObjectId.isValid(adminUserId)) {
    existing.sentBy = new Types.ObjectId(adminUserId);
  }
  await existing.save();

  return existing;
};

export const SmsService = {
  sendSingleSms,
  getCreditBalance,
  notifyOfflineMerchantOnNewOrder,
  sendManualAdminSms,
  getSmsSummaryAndLogs,
  getMerchantSmsStats,
  resendSmsLog,
};
