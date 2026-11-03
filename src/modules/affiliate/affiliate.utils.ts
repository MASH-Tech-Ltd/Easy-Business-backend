import crypto from 'crypto';
import { Types } from 'mongoose';
import { Affiliate, AffiliateAuditLog } from './affiliate.model';
import { GlobalSetting } from '../system/globalSetting.model';
import { AFFILIATE_DEFAULT_SETTINGS } from './affiliate.constants';
import { ICommissionSnapshot } from './affiliate.types';

/**
 * Rounds a financial number to 2 decimal places accurately.
 * Example: 499 * 0.30 = 149.7, 399 * 0.30 = 119.7
 */
export const round2 = (num: number): number => {
  return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
};

/**
 * Retrieves the active Affiliate Global Settings merged with safe defaults.
 */
export const getAffiliateGlobalConfig = async () => {
  const settings = await GlobalSetting.findOne().lean();
  const raw = (settings as any)?.affiliateSettings || {};
  return {
    ...AFFILIATE_DEFAULT_SETTINGS,
    ...raw,
    notifications: {
      ...AFFILIATE_DEFAULT_SETTINGS.notifications,
      ...(raw.notifications || {}),
    },
  };
};

/**
 * Generates a unique, collision-resistant uppercase referral code.
 * Example: MASH-AFF-9K2X7
 */
export const generateUniqueAffiliateCode = async (prefix = 'MASH'): Promise<string> => {
  const cleanPrefix = (prefix || 'MASH').replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'MASH';
  for (let attempt = 0; attempt < 15; attempt++) {
    const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
    const candidate = `${cleanPrefix}-AFF-${randomPart}`;
    const exists = await Affiliate.exists({ affiliateCode: candidate });
    if (!exists) {
      return candidate;
    }
  }
  const fallback = `${cleanPrefix}-AFF-${Date.now().toString(36).toUpperCase()}`;
  return fallback;
};

/**
 * Builds an immutable commission configuration snapshot for a referred merchant.
 */
export const buildCommissionSnapshot = async (
  affiliateOverride?: {
    commissionRate?: number | undefined;
    durationMonths?: number | undefined;
    commissionType?: 'recurring' | 'one_time' | undefined;
  } | null
): Promise<ICommissionSnapshot> => {
  const globalConfig = await getAffiliateGlobalConfig();
  return {
    commissionRate:
      typeof affiliateOverride?.commissionRate === 'number' && affiliateOverride.commissionRate >= 0
        ? affiliateOverride.commissionRate
        : Number(globalConfig.defaultCommissionRate ?? 30),
    durationMonths:
      typeof affiliateOverride?.durationMonths === 'number' && affiliateOverride.durationMonths >= 1
        ? affiliateOverride.durationMonths
        : Number(globalConfig.commissionDurationMonths ?? 6),
    commissionType:
      affiliateOverride?.commissionType || globalConfig.commissionType || 'recurring',
    approvalMode: globalConfig.commissionApprovalMode || 'auto',
    holdDays: Number(globalConfig.holdDays ?? 0),
  };
};

/**
 * Helper to record an immutable audit log entry.
 */
export const recordAffiliateAuditLog = async (params: {
  actorId?: string | Types.ObjectId | null | undefined;
  actorRole: string;
  action: string;
  targetType: 'affiliate' | 'commission' | 'withdrawal' | 'settings' | 'referral';
  targetId: string;
  reason?: string | undefined;
  metadata?: Record<string, any> | undefined;
  ipAddress?: string | undefined;
}): Promise<void> => {
  try {
    await AffiliateAuditLog.create({
      actorId: params.actorId ? new Types.ObjectId(params.actorId.toString()) : null,
      actorRole: params.actorRole || 'system',
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      reason: params.reason || '',
      metadata: params.metadata || {},
      ipAddress: params.ipAddress || '',
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('[AffiliateAuditLog] Failed to record audit log:', err);
  }
};

/**
 * Safe Socket.IO emitter helper that never throws if Socket.IO is not initialized.
 */
export const emitAffiliateSocketEvent = (
  room: string,
  event: string,
  payload: Record<string, any>
): void => {
  try {
    const { getIO } = require('../../socket');
    const io = getIO();
    if (io) {
      io.to(room).emit(event, payload);
    }
  } catch (_err) {
    // Socket may not be initialized in CLI/test scripts
  }
};

