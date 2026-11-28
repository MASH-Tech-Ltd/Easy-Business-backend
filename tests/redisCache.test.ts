import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheKeys, normalizeSearchTerm } from '../src/services/cache/cache.keys';
import { withJitter } from '../src/services/cache/cache.ttl';
import { withStampedeProtection } from '../src/services/cache/cache.lock';
import { CacheService } from '../src/services/cache/cache.service';
import { getCacheAnalyticsSnapshot, recordCacheHit, recordCacheMiss } from '../src/infrastructure/redis/redis.metrics';

test('Multi-tenant cache keys strictly isolate stores and normalize filters', () => {
  const keyA = CacheKeys.storeProductsList('storeA', 1, {
    page: 1,
    limit: 20,
    sort: 'price_asc',
    search: '  iPhone   15  ',
  });
  const keyB = CacheKeys.storeProductsList('storeB', 1, {
    page: 1,
    limit: 20,
    sort: 'price_asc',
    search: 'iphone 15',
  });
  const keyAEquivalent = CacheKeys.storeProductsList('storeA', 1, {
    page: 1,
    limit: 20,
    sort: 'price_asc',
    search: 'iphone 15',
  });

  assert.notEqual(keyA, keyB);
  assert.ok(keyA.startsWith('store:storea:products:v1:'));
  assert.ok(keyB.startsWith('store:storeb:products:v1:'));
  assert.equal(keyA, keyAEquivalent);
  assert.equal(normalizeSearchTerm('  Laptop   Pro '), 'laptop pro');
});

test('TTL jitter stays within expected bounds', () => {
  for (let i = 0; i < 30; i++) {
    const ttl = withJitter(120, 0.1);
    assert.ok(ttl >= 108 && ttl <= 132, `Expected TTL in [108, 132], got ${ttl}`);
  }
});

test('Stampede protection single-flight runs fetcher once for concurrent callers', async () => {
  let dbCalls = 0;
  const fetcher = async () => {
    dbCalls++;
    await new Promise((r) => setTimeout(r, 30));
    return { items: [1, 2, 3] };
  };

  const results = await Promise.all(
    Array.from({ length: 20 }, () => withStampedeProtection('test:stampede:key', fetcher))
  );

  assert.equal(dbCalls, 1);
  assert.equal(results.length, 20);
  assert.deepEqual(results[0], { items: [1, 2, 3] });
});

test('CacheService fails open when Redis is unavailable', async () => {
  const cached = await CacheService.get('nonexistent:key', { silent: true });
  assert.equal(cached, null);

  let fetched = 0;
  const { value, hit } = await CacheService.getOrSet(
    'failopen:test',
    async () => {
      fetched++;
      return { ok: true };
    },
    { group: 'other', ttlSeconds: 60 }
  );

  assert.equal(hit, false);
  assert.equal(fetched, 1);
  assert.deepEqual(value, { ok: true });
});

test('Cache metrics track hits, misses, and hit rate accurately', () => {
  const before = getCacheAnalyticsSnapshot();
  recordCacheHit('product');
  recordCacheHit('product');
  recordCacheMiss('product');
  const after = getCacheAnalyticsSnapshot();

  assert.equal(after.totals.hits, before.totals.hits + 2);
  assert.equal(after.totals.misses, before.totals.misses + 1);
  assert.ok(after.totals.hitRatePercent >= 0 && after.totals.hitRatePercent <= 100);
});
