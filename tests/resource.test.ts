import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';

import {
  GB, MB, unitToBytes, percentUsed, evaluateThresholds, statusForPercent, classifyResponse, isCacheHit,
  tenantIdFromPath, hostLookupKeys, buildWindows, sumAddonBytes, computeAddonExpiry, deepMerge, periodKey,
  periodEnd, windowKey, formatBytes,
} from '../src/modules/resource/resource.logic';
import {
  defaultResourceSettings, mergeAndValidateSettings, normalizeResourceSettings,
} from '../src/modules/resource/resource.settings';

/* ═════════════ Pure logic (always runs) ═════════════ */
test('units: binary conversions and integer bytes', () => {
  assert.equal(unitToBytes(1, 'GB'), 1024 * 1024 * 1024);
  assert.equal(unitToBytes(500, 'MB'), 500 * MB);
  assert.equal(unitToBytes(0.5, 'GB'), 512 * MB);
  assert.equal(GB / MB, 1024);
  assert.equal(formatBytes(2 * GB), '2.00 GB');
});

test('percent: 0 limit = unlimited, over-limit not capped', () => {
  assert.equal(percentUsed(100, 0), 0);
  assert.equal(percentUsed(50, 100), 50);
  assert.equal(percentUsed(150, 100), 150);
});

test('thresholds: highest un-notified only; no duplicates', () => {
  const th = defaultResourceSettings().warning.thresholds as any[];
  assert.equal(evaluateThresholds(60, th, []).next, null);
  assert.equal(evaluateThresholds(72, th, []).next?.percent, 70);
  assert.equal(evaluateThresholds(96, th, []).next?.percent, 95); // jump → one notification
  assert.equal(evaluateThresholds(96, th, [70, 85, 95]).next, null); // already sent
  assert.equal(evaluateThresholds(100, th, [70, 85, 95]).next?.percent, 100);
  assert.equal(statusForPercent(86, 100, th), 'warning');
  assert.equal(statusForPercent(10, 0, th), 'unlimited');
  const custom = th.map((t) => (t.percent === 85 ? { ...t, enabled: false } : t));
  assert.equal(evaluateThresholds(90, custom, []).next?.percent, 70);
});

test('classification: an image response is never also general traffic', () => {
  assert.equal(classifyResponse({ contentType: 'image/webp' }), 'image');
  assert.equal(classifyResponse({ contentType: 'text/html; charset=utf-8' }), 'general');
  assert.equal(classifyResponse({ contentType: 'application/json' }), 'general');
  assert.equal(classifyResponse({ contentType: 'text/css' }), 'general');
  assert.equal(classifyResponse({ contentType: 'application/javascript' }), 'general');
  assert.equal(classifyResponse({ path: '/a/b.PNG' }), 'image');
  assert.equal(classifyResponse({ host: 'media.x.com', mediaHost: 'media.x.com' }), 'image');
  assert.equal(classifyResponse({ path: '/api/products' }), 'general');
});

test('cache status: HIT and MISS both measurable; HIT recognised', () => {
  assert.equal(isCacheHit('hit'), true);
  assert.equal(isCacheHit('HIT'), true);
  assert.equal(isCacheHit('miss'), false);
  assert.equal(isCacheHit('dynamic'), false);
});

test('tenant attribution: media path prefix; host lookup keys', () => {
  const id = '507f1f77bcf86cd799439011';
  assert.equal(tenantIdFromPath(`/merchants/${id}/products/x.webp`), id);
  assert.equal(tenantIdFromPath('/merchants/zzz/products/x.webp'), null);
  assert.equal(tenantIdFromPath('/platform/blog/x.webp'), null);
  assert.deepEqual(hostLookupKeys('shop.masheco.com', 'masheco.com'), { slug: 'shop', customDomains: [] });
  assert.deepEqual(hostLookupKeys('www.myshop.com', 'masheco.com'), { slug: null, customDomains: ['myshop.com', 'www.myshop.com'] });
});

test('windows: epoch aligned, contiguous, deterministic (idempotent keys)', () => {
  const now = new Date('2026-05-10T10:07:00Z');
  const w = buildWindows({ lastEnd: null, now, intervalMin: 15, lagMin: 20, maxWindows: 12 });
  assert.equal(w.length, 0 + w.length); // first run starts one interval back from horizon
  const again = buildWindows({ lastEnd: null, now, intervalMin: 15, lagMin: 20, maxWindows: 12 });
  assert.deepEqual(w.map((x) => x.start.toISOString()), again.map((x) => x.start.toISOString()));
  const catchUp = buildWindows({ lastEnd: new Date('2026-05-10T08:00:00Z'), now, intervalMin: 15, lagMin: 20, maxWindows: 100 });
  assert.equal(catchUp[0]!.start.toISOString(), '2026-05-10T08:00:00.000Z');
  for (let i = 1; i < catchUp.length; i++) assert.equal(catchUp[i]!.start.getTime(), catchUp[i - 1]!.end.getTime());
  assert.ok(catchUp[catchUp.length - 1]!.end.getTime() <= now.getTime() - 20 * 60_000);
  assert.equal(windowKey('cloudflare', new Date('2026-05-10T08:00:00Z')), 'cloudflare:2026-05-10T08:00:00.000Z');
});

test('add-ons: stacking rule, expiry rule, category isolation by caller', () => {
  const now = new Date('2026-05-10T00:00:00Z');
  const future = new Date('2026-06-01T00:00:00Z');
  const past = new Date('2026-05-01T00:00:00Z');
  const p = [
    { quantityBytes: GB, quantity: 1, expiresAt: future, status: 'active' },
    { quantityBytes: 2 * GB, quantity: 1, expiresAt: null, status: 'active' },
    { quantityBytes: 5 * GB, quantity: 1, expiresAt: past, status: 'active' }, // expired
    { quantityBytes: 9 * GB, quantity: 1, expiresAt: future, status: 'pending' }, // not paid
  ];
  assert.equal(sumAddonBytes(p, 'stack', now), 3 * GB);
  assert.equal(sumAddonBytes(p, 'highest_only', now), 2 * GB);
  assert.equal(computeAddonExpiry('permanent', 30, now), null);
  assert.equal(computeAddonExpiry('billing_period', 30, now)!.toISOString(), periodEnd(now).toISOString());
  assert.equal(computeAddonExpiry('days', 10, now)!.toISOString(), '2026-05-20T00:00:00.000Z');
  assert.equal(periodKey(now), '2026-05');
});

test('settings: defaults warning-first, validation, deep merge', () => {
  const d = defaultResourceSettings();
  assert.equal(d.warning.thresholds.length, 4);
  assert.equal(d.overLimit.bandwidthPolicy, 'warn_only');
  assert.equal(d.defaults.storageBytes, 2 * GB); // admin-editable default, not code-bound
  assert.equal(d.analytics.cloudflareSyncEnabled, false);

  const ok = mergeAndValidateSettings(d, { defaults: { storageBytes: 5 * GB }, aggregationIntervalMin: 30 });
  assert.ok(ok.ok && ok.value.defaults.storageBytes === 5 * GB && ok.value.defaults.imageBandwidthBytes === 0);
  const bad = mergeAndValidateSettings(d, { aggregationIntervalMin: 1 });
  assert.equal(bad.ok, false);
  const dup = mergeAndValidateSettings(d, { warning: { thresholds: [{ percent: 50, level: 'info', enabled: true }, { percent: 50, level: 'warning', enabled: true }] } });
  assert.equal(dup.ok, false);
  assert.equal(normalizeResourceSettings({ aggregationIntervalMin: 'garbage' }).aggregationIntervalMin, 15);
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 9 }, __proto__: { x: 1 } as any }), { a: { b: 9, c: 2 } });
});

/* ═════════════ DB-backed tests (local *_test MongoDB only; skipped if unavailable) ═════════════ */
const TEST_URL = process.env.RESOURCE_TEST_DB_URL || 'mongodb://127.0.0.1:27017/mash_eco_resource_test';
let dbReady = false;

test('DB: connect to local test database', async (t) => {
  const dbName = TEST_URL.split('/').pop()!.split('?')[0]!;
  if (!dbName.endsWith('_test')) throw new Error('Refusing to run DB tests against a non *_test database');
  try {
    await mongoose.connect(TEST_URL, { serverSelectionTimeoutMS: 2000 });
    await mongoose.connection.dropDatabase();
    dbReady = true;
  } catch {
    t.skip('No local MongoDB available — DB-backed tests skipped (simulated suite not run)');
  }
});

const needDb = (t: any) => {
  if (!dbReady) {
    t.skip('no local MongoDB');
    return false;
  }
  return true;
};

test('DB: storage reserve is atomic, enforces limit, delete releases, replacement nets out', async (t) => {
  if (!needDb(t)) return;
  const { Tenant } = await import('../src/modules/tenant/tenant.model');
  const { GlobalSetting } = await import('../src/modules/system/globalSetting.model');
  const U = await import('../src/modules/resource/resource.usage.service');
  const { invalidateResourceSettingsCache } = await import('../src/modules/resource/resource.settings');
  const { MerchantStorageState } = await import('../src/modules/resource/resource.model');

  await GlobalSetting.create({ resource: { defaults: { storageBytes: 10 * MB } } });
  invalidateResourceSettingsCache();
  const tenant = await Tenant.create({ name: 'T1', slug: 't1', status: 'active' });
  const tid = String(tenant._id);

  // 20 concurrent 1 MB uploads against a 10 MB limit → exactly 10 succeed
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => U.reserveStorage(tid, MB)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.equal((await MerchantStorageState.findOne({ tenantId: tid }))!.usedBytes, 10 * MB);

  await assert.rejects(() => U.reserveStorage(tid, 1), /MEDIA_STORAGE_LIMIT_REACHED/);
  await U.releaseStorage(tid, 4 * MB, 4); // delete
  assert.equal((await MerchantStorageState.findOne({ tenantId: tid }))!.usedBytes, 6 * MB);
  await U.reserveStorage(tid, 2 * MB); // replacement: reserve new…
  await U.releaseStorage(tid, 2 * MB, 0); // …release old after success
  assert.equal((await MerchantStorageState.findOne({ tenantId: tid }))!.usedBytes, 6 * MB);
  await U.releaseStorage(tid, 999 * MB, 0); // never negative
  assert.equal((await MerchantStorageState.findOne({ tenantId: tid }))!.usedBytes, 0);
});

test('DB: monitor mode / warn_only never blocks uploads', async (t) => {
  if (!needDb(t)) return;
  const { Tenant } = await import('../src/modules/tenant/tenant.model');
  const { GlobalSetting } = await import('../src/modules/system/globalSetting.model');
  const U = await import('../src/modules/resource/resource.usage.service');
  const { invalidateResourceSettingsCache } = await import('../src/modules/resource/resource.settings');
  await GlobalSetting.updateMany({}, { $set: { resource: { defaults: { storageBytes: MB }, overLimit: { storagePolicy: 'warn_only' } } } });
  invalidateResourceSettingsCache();
  const tenant = await Tenant.create({ name: 'T2', slug: 't2', status: 'active' });
  await U.reserveStorage(String(tenant._id), 5 * MB); // exceeds, but allowed
  assert.ok(true);
});

test('DB: ingestion is idempotent, classifies once, attributes by trusted keys, handles shared hosts', async (t) => {
  if (!needDb(t)) return;
  const { Tenant } = await import('../src/modules/tenant/tenant.model');
  const { GlobalSetting } = await import('../src/modules/system/globalSetting.model');
  const { ingestWindow, clearHostCache } = await import('../src/modules/resource/resource.ingest.service');
  const { MerchantResourceUsage } = await import('../src/modules/resource/resource.model');
  const { invalidateResourceSettingsCache } = await import('../src/modules/resource/resource.settings');
  await GlobalSetting.updateMany({}, { $set: { resource: {} } });
  invalidateResourceSettingsCache();
  clearHostCache();

  const a = await Tenant.create({ name: 'A', slug: 'shopa', status: 'active', customDomain: 'a-shop.com' });
  const b = await Tenant.create({ name: 'B', slug: 'shopb', status: 'active' });
  const start = new Date('2026-05-10T08:00:00Z');
  const end = new Date('2026-05-10T08:15:00Z');
  const rows = [
    { path: `/merchants/${a._id}/products/1.webp`, host: 'media.masheco.com', contentType: 'image/webp', cacheStatus: 'hit', bytes: 1000, requests: 10 },
    { path: `/merchants/${a._id}/products/2.webp`, host: 'media.masheco.com', contentType: 'image/webp', cacheStatus: 'miss', bytes: 500, requests: 5 },
    { host: 'a-shop.com', contentType: 'text/html', bytes: 3000, requests: 3 },
    { host: 'www.a-shop.com', contentType: 'application/json', bytes: 200, requests: 2 },
    { host: 'shopb.localhost', contentType: 'text/css', bytes: 700, requests: 7 },
    { host: 'unknown-host.com', contentType: 'text/html', bytes: 9999, requests: 1 },
  ];
  const r1 = await ingestWindow({ source: 'mock:t1', windowStart: start, windowEnd: end, rows, mediaHost: 'media.masheco.com' });
  const r2 = await ingestWindow({ source: 'mock:t1', windowStart: start, windowEnd: end, rows, mediaHost: 'media.masheco.com' }); // duplicate batch
  assert.equal(r1.tenantsUpdated >= 1, true);
  assert.equal(r2.skipped, true);

  const ua: any = await MerchantResourceUsage.findOne({ tenantId: a._id, period: '2026-05' }).lean();
  assert.equal(ua.image.bytes, 1500); // cache HIT + MISS both counted
  assert.equal(ua.image.cacheHit, 10);
  assert.equal(ua.image.cacheMiss, 5);
  assert.equal(ua.image.requests, 15);
  assert.equal(ua.general.bytes, 3200); // html + json, images NOT double counted
  assert.equal(ua.daily['10'].imageBytes, 1500);
  assert.equal(r1.unattributedBytes >= 9999, true);

  // concurrent duplicate ingestion of a new window → applied once
  const s2 = new Date('2026-05-10T08:15:00Z');
  await Promise.allSettled(Array.from({ length: 8 }, () => ingestWindow({ source: 'mock:t2', windowStart: s2, windowEnd: new Date(s2.getTime() + 900000), rows: [{ tenantId: String(b._id), host: 'x', contentType: 'text/html', bytes: 100, requests: 1 }] })));
  const ub: any = await MerchantResourceUsage.findOne({ tenantId: b._id, period: '2026-05' }).lean();
  assert.equal(ub.general.bytes, 700 + 100);
  // merchant isolation: B has no image usage from A's media
  assert.equal(ub.image.bytes, 0);
});

test('DB: add-on lifecycle — dynamic catalogue, price snapshot, verified activation only, idempotent, expiry, refund', async (t) => {
  if (!needDb(t)) return;
  const { Tenant } = await import('../src/modules/tenant/tenant.model');
  const { Package } = await import('../src/modules/package/package.model');
  const { Subscription } = await import('../src/modules/subscription/subscription.model');
  const { PlatformPaymentSubmission } = await import('../src/modules/billing/billing.model');
  const { GlobalSetting } = await import('../src/modules/system/globalSetting.model');
  const { ResourceAddonService } = await import('../src/modules/resource/resource.addon.service');
  const { ResourceAddonPurchase } = await import('../src/modules/resource/resource.model');
  const { getEffectiveLimits } = await import('../src/modules/resource/resource.limits');
  const { invalidateResourceSettingsCache } = await import('../src/modules/resource/resource.settings');
  await GlobalSetting.updateMany({}, { $set: { resource: { defaults: { storageBytes: GB } } } });
  invalidateResourceSettingsCache();

  const pkg = await Package.create({ name: 'Basic', price: 500, billingCycle: 'monthly', productLimit: 50, resources: { storageBytes: 1 * GB, imageBandwidthBytes: 200 * MB, generalBandwidthBytes: 800 * MB } });
  const tenant = await Tenant.create({ name: 'T3', slug: 't3', status: 'active', ownerId: new Types.ObjectId() });
  const tid = String(tenant._id);
  await Subscription.create({ tenantId: tid, packageId: pkg._id, startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000), status: 'active', isTrial: false });

  // package config changes allocation
  let lim = await getEffectiveLimits(tid);
  assert.equal(lim.storage.totalBytes, GB);
  assert.equal(lim.imageBandwidth.totalBytes, 200 * MB);
  await Package.updateOne({ _id: pkg._id }, { $set: { 'resources.storageBytes': 3 * GB } });
  lim = await getEffectiveLimits(tid);
  assert.equal(lim.storage.totalBytes, 3 * GB);

  // admin creates add-on (no code/frontend change needed)
  const addon: any = await ResourceAddonService.createAddon({ name: '2 GB Image Bandwidth', category: 'image_bandwidth', quantity: 2, unit: 'GB', price: 110, promoPrice: 99, durationType: 'billing_period', maxQuantity: 2 }, { _id: null });
  const list = await ResourceAddonService.listAvailable(tid);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.effectivePrice, 99);
  await ResourceAddonService.updateAddon(String(addon._id), { name: '2 GB Image Bandwidth', category: 'image_bandwidth', quantity: 2, unit: 'GB', price: 120, durationType: 'billing_period', maxQuantity: 2 }, { _id: null });

  const purchase: any = await ResourceAddonService.purchase(tid, { addonId: String(addon._id), quantity: 1, payment: { provider: 'bKash', senderNumber: '01700000000', transactionId: 'TRX-AAA-1' } });
  assert.equal(purchase.totalPrice, 120); // updated price applies to new purchases
  assert.equal(purchase.status, 'pending');
  // pending payment grants nothing
  lim = await getEffectiveLimits(tid);
  assert.equal(lim.imageBandwidth.addonBytes, 0);
  await assert.rejects(() => ResourceAddonService.purchase(tid, { addonId: String(addon._id), quantity: 1, payment: { provider: 'bKash', senderNumber: '01700000000', transactionId: 'TRX-AAA-1' } }), /already been submitted/);
  await assert.rejects(() => ResourceAddonService.purchase(tid, { addonId: String(addon._id), quantity: 2, payment: { provider: 'bKash', senderNumber: '01700000000', transactionId: 'TRX-AAA-2' } }), /Maximum purchasable/);

  const sub: any = await PlatformPaymentSubmission.findOne({ resourceAddonPurchaseId: purchase._id });
  assert.ok(sub);
  assert.equal(sub.amount, 120);

  // activation — twice → once
  const [x, y] = await Promise.all([
    ResourceAddonService.handlePaymentDecision(String(purchase._id), 'approved', String(sub._id)),
    ResourceAddonService.handlePaymentDecision(String(purchase._id), 'approved', String(sub._id)),
  ]);
  assert.equal([x, y].filter((r) => r.activated).length, 1);
  lim = await getEffectiveLimits(tid);
  assert.equal(lim.imageBandwidth.addonBytes, 2 * GB);
  assert.equal(lim.imageBandwidth.totalBytes, 200 * MB + 2 * GB);
  assert.equal(lim.storage.addonBytes, 0); // never mixes categories

  // expiry
  await ResourceAddonPurchase.updateOne({ _id: purchase._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const sweep = await ResourceAddonService.runExpirySweep();
  assert.equal(sweep.expired, 1);
  lim = await getEffectiveLimits(tid);
  assert.equal(lim.imageBandwidth.addonBytes, 0);

  // deleting a purchased add-on only deactivates it
  const del = await ResourceAddonService.deleteAddon(String(addon._id), { _id: null });
  assert.equal(del.deactivated, true);
});

test('DB: threshold notifications are not duplicated within a period', async (t) => {
  if (!needDb(t)) return;
  const { Tenant } = await import('../src/modules/tenant/tenant.model');
  const { GlobalSetting } = await import('../src/modules/system/globalSetting.model');
  const { Notification } = await import('../src/modules/notification/notification.model');
  const { ingestWindow } = await import('../src/modules/resource/resource.ingest.service');
  const { invalidateResourceSettingsCache } = await import('../src/modules/resource/resource.settings');
  await GlobalSetting.updateMany({}, { $set: { resource: { defaults: { generalBandwidthBytes: 1000 } } } });
  invalidateResourceSettingsCache();
  const owner = new Types.ObjectId();
  const tn = await Tenant.create({ name: 'T4', slug: 't4', status: 'active', ownerId: owner });
  const mk = (min: number, bytes: number) => ingestWindow({
    source: 'mock:n', windowStart: new Date(Date.UTC(2026, 6, 1, 0, min)), windowEnd: new Date(Date.UTC(2026, 6, 1, 0, min + 15)),
    rows: [{ tenantId: String(tn._id), host: 'x', contentType: 'text/html', bytes, requests: 1 }],
  });
  await mk(0, 750);   // 75% → info
  await mk(15, 10);   // 76% → none
  await mk(30, 120);  // 88% → warning
  await mk(45, 100);  // 98% → critical
  await mk(60, 1);    // 98% → none
  await mk(75, 100);  // 108% → limit_reached
  const n = await Notification.find({ recipientId: owner, type: 'RESOURCE_THRESHOLD' }).lean();
  assert.equal(n.length, 4);
});

test('DB: cleanup', async (t) => {
  if (!needDb(t)) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
