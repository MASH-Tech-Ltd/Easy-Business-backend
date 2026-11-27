import { Types } from 'mongoose';
import { Subscription } from '../subscription/subscription.model';
import { Package } from '../package/package.model';
import { ResourceAddonPurchase } from './resource.model';
import { getResourceSettings, ResourceSettings } from './resource.settings';
import { sumAddonBytes, GB } from './resource.logic';

const LEGACY_STORAGE_ADDON_SLUGS = new Set(['media_storage_boost', 'extra_media_storage']);

export interface LimitPart {
  baseBytes: number;
  addonBytes: number;
  totalBytes: number; // 0 = unlimited
}
export interface EffectiveLimits {
  trackingEnabled: boolean;
  packageId: string | null;
  packageName: string | null;
  hasActiveSubscription: boolean;
  storage: LimitPart;
  imageBandwidth: LimitPart;
  generalBandwidth: LimitPart;
  combined: LimitPart;
  policy: { storage: string; bandwidth: string; enforcement: 'monitor' | 'enforce' };
  settings: ResourceSettings;
}

const part = (base: number, addon: number): LimitPart => {
  // 0 base = unlimited regardless of add-ons
  const b = Math.max(0, Math.round(base || 0));
  const a = Math.max(0, Math.round(addon || 0));
  return { baseBytes: b, addonBytes: a, totalBytes: b > 0 ? b + a : 0 };
};

const pick = (pkgValue: unknown, fallback: number): number =>
  typeof pkgValue === 'number' && Number.isFinite(pkgValue) && pkgValue >= 0 ? pkgValue : fallback;

/**
 * Effective allocation = package base (or global default when the package field is unset)
 * + live add-on credits of the same category. Add-ons never cross categories.
 * No active subscription → global defaults (documented policy; nothing is deleted).
 */
export const getEffectiveLimits = async (tenantId: string | Types.ObjectId): Promise<EffectiveLimits> => {
  const tid = new Types.ObjectId(String(tenantId));
  const settings = await getResourceSettings();
  const now = new Date();

  const sub: any = await Subscription.findOne({ tenantId: tid, status: 'active' })
    .select('packageId endDate purchasedAddons')
    .populate('purchasedAddons.addonId', 'slug')
    .lean();
  const activeSub = sub && (!sub.endDate || new Date(sub.endDate).getTime() > now.getTime()) ? sub : null;

  // Backward compatibility: legacy count-based storage add-ons (limit = GB) keep adding capacity.
  let legacyStorageBytes = 0;
  for (const pa of (activeSub?.purchasedAddons as any[]) || []) {
    const slug = pa?.addonId?.slug;
    if (slug && LEGACY_STORAGE_ADDON_SLUGS.has(slug) && (pa.status === 'active' || pa.isActive === true)) {
      legacyStorageBytes += Math.max(0, Number(pa.limit) || 0) * GB;
    }
  }
  const pkg: any =
    activeSub && activeSub.packageId
      ? await Package.findById(activeSub.packageId).select('name resources').lean()
      : null;
  const res = pkg?.resources || {};
  const trackingEnabled = res.trackingEnabled !== false;

  const purchases: any[] = await ResourceAddonPurchase.find({ tenantId: tid, status: 'active' })
    .select('category quantityBytes quantity expiresAt status')
    .lean();
  const byCat = (cat: string) =>
    sumAddonBytes(
      purchases.filter((p) => p.category === cat),
      settings.billing.stacking,
      now,
    );

  const d = settings.defaults;
  const storage = part(pick(res.storageBytes, d.storageBytes), byCat('storage') + legacyStorageBytes);
  const imageBw = part(pick(res.imageBandwidthBytes, d.imageBandwidthBytes), byCat('image_bandwidth'));
  const generalBw = part(pick(res.generalBandwidthBytes, d.generalBandwidthBytes), byCat('general_bandwidth'));
  const combinedBase = pick(res.combinedBandwidthBytes, d.combinedBandwidthBytes);
  const combined = part(combinedBase, 0);

  return {
    trackingEnabled,
    packageId: pkg?._id ? String(pkg._id) : null,
    packageName: pkg?.name || null,
    hasActiveSubscription: !!activeSub,
    storage,
    imageBandwidth: imageBw,
    generalBandwidth: generalBw,
    combined,
    policy: {
      storage: res.overLimitPolicy || settings.overLimit.storagePolicy,
      bandwidth: res.overLimitPolicy || settings.overLimit.bandwidthPolicy,
      enforcement: settings.enforcementMode,
    },
    settings,
  };
};

/** Effective warning thresholds for a tenant (package override > global). */
export const thresholdsFor = (limits: EffectiveLimits, packageThresholds?: any[]) =>
  Array.isArray(packageThresholds) && packageThresholds.length
    ? packageThresholds
    : limits.settings.warning.thresholds;
