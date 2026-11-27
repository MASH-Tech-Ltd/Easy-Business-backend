import { Types } from 'mongoose';
import { z } from 'zod';
import CustomError from '../../helpers/CustomError';
import { Subscription } from '../subscription/subscription.model';
import { PlatformPaymentSubmission } from '../billing/billing.model';
import { User } from '../auth/auth.model';
import { Tenant } from '../tenant/tenant.model';
import { notificationService } from '../notification/notification.service';
import { ResourceAddon, ResourceAddonPurchase, ResourceAuditLog } from './resource.model';
import { getResourceSettings } from './resource.settings';
import { computeAddonExpiry, formatBytes, unitToBytes } from './resource.logic';
import { notifyTenantOwner } from './resource.usage.service';

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'invalid id');

export const addonInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(''),
  category: z.enum(['storage', 'image_bandwidth', 'general_bandwidth']),
  quantity: z.number().positive().max(1_000_000),
  unit: z.enum(['MB', 'GB']),
  price: z.number().min(0).max(10_000_000),
  promoPrice: z.number().min(0).max(10_000_000).nullable().optional(),
  durationType: z.enum(['billing_period', 'days', 'subscription_bound', 'permanent']).default('billing_period'),
  durationDays: z.number().int().min(1).max(3650).default(30),
  billingType: z.enum(['one_time', 'recurring']).default('one_time'),
  isCustomQuantity: z.boolean().default(false),
  minQuantity: z.number().int().min(1).max(1000).default(1),
  maxQuantity: z.number().int().min(1).max(1000).default(1),
  isActive: z.boolean().default(true),
  availablePackageIds: z.array(objectId).default([]),
  autoRenew: z.boolean().default(false),
  displayOrder: z.number().int().min(-10000).max(10000).default(0),
});

const fromInput = (i: z.infer<typeof addonInputSchema>) => {
  if (i.promoPrice != null && i.promoPrice >= i.price) {
    throw new CustomError(400, 'Promotional price must be lower than the regular price');
  }
  if (i.minQuantity > i.maxQuantity) {
    throw new CustomError(400, 'Minimum quantity cannot exceed maximum quantity');
  }
  return {
    name: i.name,
    description: i.description,
    category: i.category,
    quantityBytes: unitToBytes(i.quantity, i.unit),
    displayQuantity: i.quantity,
    displayUnit: i.unit,
    price: i.price,
    promoPrice: i.promoPrice ?? null,
    durationType: i.durationType,
    durationDays: i.durationDays,
    billingType: i.billingType,
    isCustomQuantity: i.isCustomQuantity,
    minQuantity: i.minQuantity,
    maxQuantity: i.maxQuantity,
    isActive: i.isActive,
    availablePackageIds: i.availablePackageIds.map((x) => new Types.ObjectId(x)),
    autoRenew: i.autoRenew,
    displayOrder: i.displayOrder,
  };
};

export const audit = async (
  actorId: any,
  action: string,
  entityType: string,
  entityId: string | undefined,
  before: any,
  after: any,
  ip?: string,
) => {
  try {
    await (ResourceAuditLog as any).create({
      actorId: actorId && Types.ObjectId.isValid(String(actorId)) ? actorId : null,
      action, entityType, entityId, before, after, ip,
    });
  } catch (e) {
    console.error('[resource:audit] failed', e);
  }
};

/* ───────────── admin catalogue ───────────── */
const createAddon = async (body: unknown, actor: any, ip?: string) => {
  const parsed = addonInputSchema.safeParse(body);
  if (!parsed.success) throw new CustomError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const doc = await ResourceAddon.create(fromInput(parsed.data));
  await audit(actor?._id, 'ADDON_CREATED', 'ResourceAddon', String(doc._id), null, doc.toObject(), ip);
  return doc;
};

const updateAddon = async (id: string, body: unknown, actor: any, ip?: string) => {
  const before = await ResourceAddon.findById(id);
  if (!before) throw new CustomError(404, 'Add-on not found');
  const parsed = addonInputSchema.safeParse(body);
  if (!parsed.success) throw new CustomError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  // Existing purchases keep their snapshot, so price/quantity edits only affect FUTURE purchases.
  const doc = await ResourceAddon.findByIdAndUpdate(id, fromInput(parsed.data), { returnDocument: 'after' });
  await audit(actor?._id, 'ADDON_UPDATED', 'ResourceAddon', id, before.toObject(), doc?.toObject(), ip);
  return doc;
};

const setAddonActive = async (id: string, isActive: boolean, actor: any, ip?: string) => {
  const doc = await ResourceAddon.findByIdAndUpdate(id, { isActive }, { returnDocument: 'after' });
  if (!doc) throw new CustomError(404, 'Add-on not found');
  await audit(actor?._id, isActive ? 'ADDON_ACTIVATED' : 'ADDON_DEACTIVATED', 'ResourceAddon', id, null, { isActive }, ip);
  return doc;
};

/** Deletes only when never purchased; otherwise deactivates (history is preserved). */
const deleteAddon = async (id: string, actor: any, ip?: string) => {
  const doc = await ResourceAddon.findById(id);
  if (!doc) throw new CustomError(404, 'Add-on not found');
  const used = await ResourceAddonPurchase.exists({ addonId: doc._id });
  if (used) {
    doc.isActive = false;
    await doc.save();
    await audit(actor?._id, 'ADDON_DEACTIVATED_INSTEAD_OF_DELETE', 'ResourceAddon', id, null, { isActive: false }, ip);
    return { deleted: false, deactivated: true };
  }
  await doc.deleteOne();
  await audit(actor?._id, 'ADDON_DELETED', 'ResourceAddon', id, doc.toObject(), null, ip);
  return { deleted: true, deactivated: false };
};

const listAddonsAdmin = async () => ResourceAddon.find().sort({ category: 1, displayOrder: 1, createdAt: 1 }).lean();

/* ───────────── merchant catalogue & purchase ───────────── */
const unitPrice = (a: { price: number; promoPrice?: number | null }) =>
  a.promoPrice != null && a.promoPrice < a.price ? a.promoPrice : a.price;

const listAvailable = async (tenantId: string) => {
  const sub: any = await Subscription.findOne({ tenantId, status: 'active' }).select('packageId isTrial').lean();
  const pkgId = sub?.packageId ? String(sub.packageId) : null;
  const addons: any[] = await ResourceAddon.find({ isActive: true }).sort({ category: 1, displayOrder: 1, createdAt: 1 }).lean();
  const mine: any[] = await ResourceAddonPurchase.find({ tenantId, status: { $in: ['pending', 'active'] } }).select('addonId quantity').lean();
  const heldByAddon = new Map<string, number>();
  for (const p of mine) heldByAddon.set(String(p.addonId), (heldByAddon.get(String(p.addonId)) || 0) + p.quantity);

  return addons
    .filter((a) => !a.availablePackageIds?.length || (pkgId && a.availablePackageIds.map(String).includes(pkgId)))
    .map((a) => {
      const held = heldByAddon.get(String(a._id)) || 0;
      return {
        id: String(a._id),
        name: a.name,
        description: a.description,
        category: a.category,
        quantityBytes: a.quantityBytes,
        displayQuantity: a.displayQuantity,
        displayUnit: a.displayUnit,
        price: a.price,
        promoPrice: a.promoPrice ?? null,
        effectivePrice: unitPrice(a),
        durationType: a.durationType,
        durationDays: a.durationDays,
        billingType: a.billingType,
        autoRenew: a.autoRenew,
        isCustomQuantity: !!a.isCustomQuantity,
        minQuantity: a.minQuantity || 1,
        maxQuantity: a.maxQuantity,
        remainingPurchasable: Math.max(0, a.maxQuantity - held),
      };
    });
};

const purchaseSchema = z.object({
  addonId: objectId,
  quantity: z.number().int().min(1).max(1000).default(1),
  payment: z.object({
    provider: z.string().trim().min(2).max(40),
    senderNumber: z.string().trim().min(3).max(40),
    transactionId: z.string().trim().min(4).max(80),
    note: z.string().trim().max(300).optional(),
  }),
});

const purchase = async (tenantId: string, body: unknown) => {
  const parsed = purchaseSchema.safeParse(body);
  if (!parsed.success) throw new CustomError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const { addonId, quantity, payment } = parsed.data;

  const sub: any = await Subscription.findOne({ tenantId, status: 'active' }).select('packageId isTrial endDate').lean();
  if (!sub) throw new CustomError(404, 'Active subscription not found for this store');
  if (sub.isTrial) throw new CustomError(400, 'Add-ons cannot be purchased during a free trial. Please upgrade to a paid plan first.');

  const addon: any = await ResourceAddon.findById(addonId).lean();
  if (!addon || !addon.isActive) throw new CustomError(404, 'Add-on not found or inactive');
  if (addon.availablePackageIds?.length && !addon.availablePackageIds.map(String).includes(String(sub.packageId))) {
    throw new CustomError(403, 'This add-on is not available for your current package');
  }

  const minQty = addon.isCustomQuantity ? Math.max(1, addon.minQuantity || 1) : 1;
  if (quantity < minQty) {
    throw new CustomError(400, `Minimum purchasable quantity for this add-on is ${minQty}`);
  }

  const held = await ResourceAddonPurchase.aggregate([
    { $match: { tenantId: new Types.ObjectId(tenantId), addonId: addon._id, status: { $in: ['pending', 'active'] } } },
    { $group: { _id: null, q: { $sum: '$quantity' } } },
  ]);
  if ((held[0]?.q || 0) + quantity > addon.maxQuantity) {
    throw new CustomError(400, `Maximum purchasable quantity for this add-on is ${addon.maxQuantity}`);
  }

  if (await PlatformPaymentSubmission.findOne({ transactionId: payment.transactionId })) {
    throw new CustomError(400, 'This Transaction ID (TrxID) has already been submitted');
  }

  // Price is ALWAYS computed server-side from the catalogue snapshot.
  const up = unitPrice(addon);
  const total = Math.round(up * quantity * 100) / 100;

  const created: any = await ResourceAddonPurchase.create({
    tenantId,
    addonId: addon._id,
    snapshot: {
      name: addon.name, category: addon.category, quantityBytes: addon.quantityBytes, unitPrice: up,
      durationType: addon.durationType, durationDays: addon.durationDays, autoRenew: addon.autoRenew,
    },
    quantity,
    totalPrice: total,
    quantityBytes: addon.quantityBytes,
    category: addon.category,
    status: 'pending',
    statusHistory: [{ status: 'pending', at: new Date(), by: 'merchant' }],
  });

  try {
    const submission: any = await PlatformPaymentSubmission.create({
      tenantId,
      purpose: 'addon',
      purposeTitle: `${addon.name} x${quantity}`,
      amount: total,
      provider: payment.provider,
      senderNumber: payment.senderNumber,
      transactionId: payment.transactionId,
      status: 'pending',
      ...(payment.note ? { note: payment.note } : {}),
      resourceAddonPurchaseId: created._id,
    });
    created.paymentSubmissionId = submission._id;
    await created.save();

    const tenant: any = await Tenant.findById(tenantId).select('name domain').lean();
    const admins = await User.find({ role: 'super_admin' }).select('_id').lean();
    for (const a of admins) {
      await notificationService.createNotification(
        a._id as any, 'PAYMENT_SUBMITTED', 'New Resource Add-on Payment',
        `Store ${tenant?.name || tenant?.domain || tenantId} submitted ৳${total} for "${addon.name}" x${quantity} (TrxID: ${payment.transactionId}).`,
        submission._id, tenantId,
      );
    }
    return created;
  } catch (err) {
    // compensate: no orphan pending purchase if payment record could not be created
    await ResourceAddonPurchase.deleteOne({ _id: created._id });
    throw err;
  }
};

const listMyPurchases = async (tenantId: string) =>
  ResourceAddonPurchase.find({ tenantId }).sort({ createdAt: -1 }).limit(200).lean();

/* ───────────── payment decision hook (called by billing.verifyPaymentSubmission) ───────────── */
const handlePaymentDecision = async (purchaseId: string, status: 'approved' | 'rejected', submissionId: string) => {
  const now = new Date();
  if (status === 'rejected') {
    await ResourceAddonPurchase.findOneAndUpdate(
      { _id: purchaseId, status: 'pending', paymentSubmissionId: submissionId },
      { $set: { status: 'rejected' }, $push: { statusHistory: { status: 'rejected', at: now, by: 'admin' } } },
    );
    return { activated: false };
  }

  const p: any = await ResourceAddonPurchase.findById(purchaseId).lean();
  if (!p) return { activated: false };
  const sub: any = await Subscription.findOne({ tenantId: p.tenantId, status: 'active' }).select('endDate').lean();
  const expiresAt = computeAddonExpiry(p.snapshot.durationType, p.snapshot.durationDays, now, sub?.endDate ? new Date(sub.endDate) : null);

  // Atomic, conditional transition: only ONE caller can move pending → active for this payment.
  const activated: any = await ResourceAddonPurchase.findOneAndUpdate(
    { _id: purchaseId, status: 'pending', paymentSubmissionId: submissionId },
    { $set: { status: 'active', activatedAt: now, expiresAt }, $push: { statusHistory: { status: 'active', at: now, by: 'admin' } } },
    { returnDocument: 'after' },
  );
  if (!activated) return { activated: false, duplicate: true };

  const settings = await getResourceSettings();
  if (settings.notifications.onAddonActivated) {
    await notifyTenantOwner(
      activated.tenantId, 'RESOURCE_ADDON_ACTIVATED', 'Add-on activated',
      `${activated.snapshot.name} x${activated.quantity} (+${formatBytes(activated.quantityBytes * activated.quantity)}) is now active` +
        (expiresAt ? ` until ${expiresAt.toISOString().slice(0, 10)}.` : '.'),
      activated._id,
    );
  }
  return { activated: true, expiresAt };
};

/** Admin refund / cancel: capacity is removed, existing files and URLs are untouched. */
const refundPurchase = async (id: string, actor: any, reason: string | undefined, ip?: string) => {
  const now = new Date();
  const doc: any = await ResourceAddonPurchase.findOneAndUpdate(
    { _id: id, status: { $in: ['active', 'pending'] } },
    { $set: { status: 'refunded', expiresAt: now }, $push: { statusHistory: { status: 'refunded', at: now, by: 'admin', note: reason } } },
    { returnDocument: 'after' },
  );
  if (!doc) throw new CustomError(400, 'Purchase not found or not refundable');
  await audit(actor?._id, 'PURCHASE_REFUNDED', 'ResourceAddonPurchase', id, null, { reason }, ip);
  await notifyTenantOwner(doc.tenantId, 'RESOURCE_ADDON_REFUNDED', 'Add-on refunded', `${doc.snapshot.name} has been refunded and removed from your allocation.`, doc._id);
  return doc;
};

/* ───────────── expiry sweep (cron) ───────────── */
const runExpirySweep = async () => {
  const now = new Date();
  const settings = await getResourceSettings();
  let expired = 0;
  let warned = 0;

  const due: any[] = await ResourceAddonPurchase.find({ status: 'active', expiresAt: { $lte: now } }).limit(200);
  for (const p of due) {
    const r = await ResourceAddonPurchase.updateOne(
      { _id: p._id, status: 'active' },
      { $set: { status: 'expired' }, $push: { statusHistory: { status: 'expired', at: now, by: 'system' } } },
    );
    if (!r.modifiedCount) continue;
    expired++;
    const storageNote = p.category === 'storage' ? ' Existing files are kept, but new uploads may be blocked if you exceed your remaining storage.' : '';
    await notifyTenantOwner(
      p.tenantId, 'RESOURCE_ADDON_EXPIRED', 'Add-on expired',
      `${p.snapshot.name} has expired.${storageNote}${p.snapshot.autoRenew ? ' Renew it from the Add-ons page.' : ''}`, p._id,
    );
  }

  const days = settings.notifications.expiryWarnDays;
  if (days > 0) {
    const soon = new Date(now.getTime() + days * 86_400_000);
    const expiring: any[] = await ResourceAddonPurchase.find({
      status: 'active', expiryNoticeSent: false, expiresAt: { $gt: now, $lte: soon },
    }).limit(200);
    for (const p of expiring) {
      const r = await ResourceAddonPurchase.updateOne({ _id: p._id, expiryNoticeSent: false }, { $set: { expiryNoticeSent: true } });
      if (!r.modifiedCount) continue;
      warned++;
      await notifyTenantOwner(
        p.tenantId, 'RESOURCE_ADDON_EXPIRING', 'Add-on expiring soon',
        `${p.snapshot.name} expires on ${new Date(p.expiresAt).toISOString().slice(0, 10)}. Renew it to keep your extra allocation.`, p._id,
      );
    }
  }
  return { expired, warned };
};

export const ResourceAddonService = {
  createAddon, updateAddon, setAddonActive, deleteAddon, listAddonsAdmin,
  listAvailable, purchase, listMyPurchases, handlePaymentDecision, refundPurchase, runExpirySweep,
};
