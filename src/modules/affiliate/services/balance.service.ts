import mongoose, { ClientSession, Types } from 'mongoose';
import CustomError from '../../../helpers/CustomError';
import { Affiliate, AffiliateLedger } from '../affiliate.model';
import { round2, emitAffiliateSocketEvent } from '../affiliate.utils';
import { AFFILIATE_SOCKET_EVENTS } from '../affiliate.constants';

const emitBalanceUpdate = (affiliate: any) => {
  emitAffiliateSocketEvent(
    `affiliate_${affiliate._id.toString()}`,
    AFFILIATE_SOCKET_EVENTS.BALANCE_UPDATED,
    {
      affiliateId: affiliate._id.toString(),
      totalEarnings: round2(affiliate.totalEarnings),
      availableBalance: round2(affiliate.availableBalance),
      pendingBalance: round2(affiliate.pendingBalance),
      reservedBalance: round2(affiliate.reservedBalance),
      totalWithdrawn: round2(affiliate.totalWithdrawn),
    }
  );
  emitAffiliateSocketEvent('admin_affiliates', AFFILIATE_SOCKET_EVENTS.ADMIN_STATS_UPDATED, {
    affiliateId: affiliate._id.toString(),
  });
};

/**
 * Credits a newly generated commission to either availableBalance (auto mode) or pendingBalance (manual/hold mode).
 */
const creditCommission = async (params: {
  affiliateId: string | Types.ObjectId;
  commissionId: string | Types.ObjectId;
  amount: number;
  isAvailableImmediately: boolean;
  description: string;
  actorId?: string | Types.ObjectId | null | undefined;
  session?: ClientSession | undefined;
}) => {
  const amt = round2(params.amount);
  if (amt <= 0) return null;

  const affiliate = await Affiliate.findById(params.affiliateId).session(params.session || null);
  if (!affiliate) throw new CustomError(404, 'Affiliate profile not found');

  const balanceBefore = round2(affiliate.availableBalance);
  const pendingBefore = round2(affiliate.pendingBalance);
  const reservedBefore = round2(affiliate.reservedBalance);

  affiliate.totalEarnings = round2(affiliate.totalEarnings + amt);
  if (params.isAvailableImmediately) {
    affiliate.availableBalance = round2(affiliate.availableBalance + amt);
  } else {
    affiliate.pendingBalance = round2(affiliate.pendingBalance + amt);
  }

  await affiliate.save({ session: params.session || null });

  await AffiliateLedger.create(
    [
      {
        affiliateId: affiliate._id,
        type: params.isAvailableImmediately ? 'commission_available' : 'commission_generated',
        direction: 'credit',
        amount: amt,
        balanceBefore,
        balanceAfter: round2(affiliate.availableBalance),
        pendingBefore,
        pendingAfter: round2(affiliate.pendingBalance),
        reservedBefore,
        reservedAfter: round2(affiliate.reservedBalance),
        referenceType: 'commission',
        referenceId: new Types.ObjectId(params.commissionId.toString()),
        description: params.description,
        actorId: params.actorId ? new Types.ObjectId(params.actorId.toString()) : null,
        createdAt: new Date(),
      },
    ],
    { session: params.session || null }
  );

  emitBalanceUpdate(affiliate);
  return affiliate;
};

/**
 * Moves a pending commission amount from pendingBalance to availableBalance.
 */
const settlePendingCommissionToAvailable = async (params: {
  affiliateId: string | Types.ObjectId;
  commissionId: string | Types.ObjectId;
  amount: number;
  description: string;
  actorId?: string | Types.ObjectId | null | undefined;
  session?: ClientSession | undefined;
}) => {
  const amt = round2(params.amount);
  const affiliate = await Affiliate.findById(params.affiliateId).session(params.session || null);
  if (!affiliate) throw new CustomError(404, 'Affiliate profile not found');

  const balanceBefore = round2(affiliate.availableBalance);
  const pendingBefore = round2(affiliate.pendingBalance);
  const reservedBefore = round2(affiliate.reservedBalance);

  affiliate.pendingBalance = round2(Math.max(0, affiliate.pendingBalance - amt));
  affiliate.availableBalance = round2(affiliate.availableBalance + amt);

  await affiliate.save({ session: params.session || null });

  await AffiliateLedger.create(
    [
      {
        affiliateId: affiliate._id,
        type: 'commission_approved',
        direction: 'credit',
        amount: amt,
        balanceBefore,
        balanceAfter: round2(affiliate.availableBalance),
        pendingBefore,
        pendingAfter: round2(affiliate.pendingBalance),
        reservedBefore,
        reservedAfter: round2(affiliate.reservedBalance),
        referenceType: 'commission',
        referenceId: new Types.ObjectId(params.commissionId.toString()),
        description: params.description,
        actorId: params.actorId ? new Types.ObjectId(params.actorId.toString()) : null,
        createdAt: new Date(),
      },
    ],
    { session: params.session || null }
  );

  emitBalanceUpdate(affiliate);
  return affiliate;
};

/**
 * Reverses a previously credited commission (from pendingBalance or availableBalance) and reduces totalEarnings.
 */
const reverseCommissionBalance = async (params: {
  affiliateId: string | Types.ObjectId;
  commissionId: string | Types.ObjectId;
  amount: number;
  wasAvailable: boolean;
  description: string;
  actorId?: string | Types.ObjectId | null | undefined;
  session?: ClientSession | undefined;
}) => {
  const amt = round2(params.amount);
  const affiliate = await Affiliate.findById(params.affiliateId).session(params.session || null);
  if (!affiliate) throw new CustomError(404, 'Affiliate profile not found');

  const balanceBefore = round2(affiliate.availableBalance);
  const pendingBefore = round2(affiliate.pendingBalance);
  const reservedBefore = round2(affiliate.reservedBalance);

  affiliate.totalEarnings = round2(Math.max(0, affiliate.totalEarnings - amt));
  if (params.wasAvailable) {
    affiliate.availableBalance = round2(Math.max(0, affiliate.availableBalance - amt));
  } else {
    affiliate.pendingBalance = round2(Math.max(0, affiliate.pendingBalance - amt));
  }

  await affiliate.save({ session: params.session || null });

  await AffiliateLedger.create(
    [
      {
        affiliateId: affiliate._id,
        type: 'commission_reversed',
        direction: 'debit',
        amount: amt,
        balanceBefore,
        balanceAfter: round2(affiliate.availableBalance),
        pendingBefore,
        pendingAfter: round2(affiliate.pendingBalance),
        reservedBefore,
        reservedAfter: round2(affiliate.reservedBalance),
        referenceType: 'commission',
        referenceId: new Types.ObjectId(params.commissionId.toString()),
        description: params.description,
        actorId: params.actorId ? new Types.ObjectId(params.actorId.toString()) : null,
        createdAt: new Date(),
      },
    ],
    { session: params.session || null }
  );

  emitBalanceUpdate(affiliate);
  return affiliate;
};

/**
 * Atomically reserves funds from availableBalance into reservedBalance when a withdrawal request is created.
 * Uses an atomic findOneAndUpdate condition (`availableBalance: { $gte: amt }`) to prevent race conditions.
 */
const reserveForWithdrawal = async (params: {
  affiliateId: string | Types.ObjectId;
  withdrawalId: string | Types.ObjectId;
  amount: number;
  description: string;
  actorId?: string | Types.ObjectId | null | undefined;
  session?: ClientSession | undefined;
}) => {
  const amt = round2(params.amount);
  const beforeDoc = await Affiliate.findById(params.affiliateId).session(params.session || null);
  if (!beforeDoc) throw new CustomError(404, 'Affiliate profile not found');

  if (round2(beforeDoc.availableBalance) < amt) {
    throw new CustomError(
      400,
      `Insufficient available balance. Available: ৳${round2(beforeDoc.availableBalance)}, Requested: ৳${amt}`
    );
  }

  const updated = await Affiliate.findOneAndUpdate(
    {
      _id: params.affiliateId,
      availableBalance: { $gte: amt },
    },
    {
      $inc: {
        availableBalance: -amt,
        reservedBalance: amt,
      },
    },
    { new: true, session: params.session || null }
  );

  if (!updated) {
    throw new CustomError(
      409,
      'Concurrent balance modification detected or insufficient available balance.'
    );
  }

  updated.availableBalance = round2(updated.availableBalance);
  updated.reservedBalance = round2(updated.reservedBalance);
  await updated.save({ session: params.session || null });

  await AffiliateLedger.create(
    [
      {
        affiliateId: updated._id,
        type: 'withdrawal_requested',
        direction: 'reserve',
        amount: amt,
        balanceBefore: round2(beforeDoc.availableBalance),
        balanceAfter: round2(updated.availableBalance),
        pendingBefore: round2(beforeDoc.pendingBalance),
        pendingAfter: round2(updated.pendingBalance),
        reservedBefore: round2(beforeDoc.reservedBalance),
        reservedAfter: round2(updated.reservedBalance),
        referenceType: 'withdrawal',
        referenceId: new Types.ObjectId(params.withdrawalId.toString()),
        description: params.description,
        actorId: params.actorId ? new Types.ObjectId(params.actorId.toString()) : null,
        createdAt: new Date(),
      },
    ],
    { session: params.session || null }
  );

  emitBalanceUpdate(updated);
  return updated;
};

/**
 * Completes a withdrawal by deducting from reservedBalance and incrementing totalWithdrawn.
 */
const completeReservedWithdrawal = async (params: {
  affiliateId: string | Types.ObjectId;
  withdrawalId: string | Types.ObjectId;
  amount: number;
  description: string;
  actorId?: string | Types.ObjectId | null | undefined;
  session?: ClientSession | undefined;
}) => {
  const amt = round2(params.amount);
  const affiliate = await Affiliate.findById(params.affiliateId).session(params.session || null);
  if (!affiliate) throw new CustomError(404, 'Affiliate profile not found');

  const balanceBefore = round2(affiliate.availableBalance);
  const pendingBefore = round2(affiliate.pendingBalance);
  const reservedBefore = round2(affiliate.reservedBalance);

  affiliate.reservedBalance = round2(Math.max(0, affiliate.reservedBalance - amt));
  affiliate.totalWithdrawn = round2(affiliate.totalWithdrawn + amt);

  await affiliate.save({ session: params.session || null });

  await AffiliateLedger.create(
    [
      {
        affiliateId: affiliate._id,
        type: 'withdrawal_completed',
        direction: 'debit',
        amount: amt,
        balanceBefore,
        balanceAfter: round2(affiliate.availableBalance),
        pendingBefore,
        pendingAfter: round2(affiliate.pendingBalance),
        reservedBefore,
        reservedAfter: round2(affiliate.reservedBalance),
        referenceType: 'withdrawal',
        referenceId: new Types.ObjectId(params.withdrawalId.toString()),
        description: params.description,
        actorId: params.actorId ? new Types.ObjectId(params.actorId.toString()) : null,
        createdAt: new Date(),
      },
    ],
    { session: params.session || null }
  );

  emitBalanceUpdate(affiliate);
  return affiliate;
};

/**
 * Releases reserved funds back to availableBalance when a withdrawal request is rejected.
 */
const releaseRejectedWithdrawal = async (params: {
  affiliateId: string | Types.ObjectId;
  withdrawalId: string | Types.ObjectId;
  amount: number;
  description: string;
  actorId?: string | Types.ObjectId | null | undefined;
  session?: ClientSession | undefined;
}) => {
  const amt = round2(params.amount);
  const affiliate = await Affiliate.findById(params.affiliateId).session(params.session || null);
  if (!affiliate) throw new CustomError(404, 'Affiliate profile not found');

  const balanceBefore = round2(affiliate.availableBalance);
  const pendingBefore = round2(affiliate.pendingBalance);
  const reservedBefore = round2(affiliate.reservedBalance);

  affiliate.reservedBalance = round2(Math.max(0, affiliate.reservedBalance - amt));
  affiliate.availableBalance = round2(affiliate.availableBalance + amt);

  await affiliate.save({ session: params.session || null });

  await AffiliateLedger.create(
    [
      {
        affiliateId: affiliate._id,
        type: 'withdrawal_rejected',
        direction: 'release',
        amount: amt,
        balanceBefore,
        balanceAfter: round2(affiliate.availableBalance),
        pendingBefore,
        pendingAfter: round2(affiliate.pendingBalance),
        reservedBefore,
        reservedAfter: round2(affiliate.reservedBalance),
        referenceType: 'withdrawal',
        referenceId: new Types.ObjectId(params.withdrawalId.toString()),
        description: params.description,
        actorId: params.actorId ? new Types.ObjectId(params.actorId.toString()) : null,
        createdAt: new Date(),
      },
    ],
    { session: params.session || null }
  );

  emitBalanceUpdate(affiliate);
  return affiliate;
};

export const AffiliateBalanceService = {
  creditCommission,
  settlePendingCommissionToAvailable,
  reverseCommissionBalance,
  reserveForWithdrawal,
  completeReservedWithdrawal,
  releaseRejectedWithdrawal,
};

