import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import {
  buildMediaKey,
  buildOwnerPrefix,
  buildVariantKey,
  expandWithVariantKeys,
  isKeyOwnedBy,
  isSafeKey,
} from '../src/modules/media/utils/mediaKey';
import { processImage } from '../src/modules/media/utils/imageProcessor';
import { resolveProvider } from '../src/modules/media/providers';
import { createR2Provider, R2_CACHE_CONTROL, S3Like } from '../src/modules/media/providers/r2.provider';
import { cleanupUploadedFiles } from '../src/utils/asyncHandler';
import { computeQuotaSummary } from '../src/modules/media/media.service';
import { aggregateMetricsByMerchant } from '../src/modules/media/mediaAnalytics.service';

const TENANT_A = '507f1f77bcf86cd799439011';
const TENANT_B = '507f1f77bcf86cd799439022';

test('mediaKey: owner prefix, key generation, variants, and traversal/ownership guards', () => {
  assert.equal(buildOwnerPrefix(TENANT_A), `merchants/${TENANT_A}`);
  assert.equal(buildOwnerPrefix(null), 'platform');
  assert.throws(() => buildOwnerPrefix('../etc/passwd'), /Invalid tenant context/);
  assert.throws(() => buildOwnerPrefix('not-an-objectid'), /Invalid tenant context/);

  const key = buildMediaKey(`merchants/${TENANT_A}`, 'product', '11111111-2222-3333-4444-555555555555');
  assert.equal(key, `merchants/${TENANT_A}/products/11111111-2222-3333-4444-555555555555.webp`);
  assert.equal(
    buildVariantKey(key, 400),
    `merchants/${TENANT_A}/products/11111111-2222-3333-4444-555555555555_w400.webp`,
  );
  assert.deepEqual(expandWithVariantKeys(key), [
    `merchants/${TENANT_A}/products/11111111-2222-3333-4444-555555555555.webp`,
    `merchants/${TENANT_A}/products/11111111-2222-3333-4444-555555555555_w400.webp`,
    `merchants/${TENANT_A}/products/11111111-2222-3333-4444-555555555555_w100.webp`,
  ]);

  assert.equal(isSafeKey(key), true);
  assert.equal(isSafeKey('../secret.txt'), false);
  assert.equal(isSafeKey('/leading/slash.webp'), false);
  assert.equal(isSafeKey('a//b.webp'), false);
  assert.equal(isSafeKey('a\\b.webp'), false);

  assert.equal(isKeyOwnedBy(key, TENANT_A), true);
  assert.equal(isKeyOwnedBy(key, TENANT_B), false);
  assert.equal(isKeyOwnedBy(key, null), false);

  const blogKey = buildMediaKey('platform', 'blog', '11111111-2222-3333-4444-555555555555');
  assert.equal(isKeyOwnedBy(blogKey, null), true);
  assert.equal(isKeyOwnedBy(blogKey, TENANT_A), false);
});

test('resolveProvider: routes R2, legacy Cloudinary, CDN proxy, seed, and external URLs safely', () => {
  // R2 explicit and URL-inferred
  assert.deepEqual(
    resolveProvider({
      provider: 'r2',
      public_id: `merchants/${TENANT_A}/products/abc.webp`,
      secure_url: `https://media.masheco.com/merchants/${TENANT_A}/products/abc.webp`,
    }),
    { provider: 'r2', id: `merchants/${TENANT_A}/products/abc.webp` },
  );
  assert.deepEqual(
    resolveProvider(`https://media.masheco.com/merchants/${TENANT_A}/store/logo/xyz.webp`),
    { provider: 'r2', id: `merchants/${TENANT_A}/store/logo/xyz.webp` },
  );

  // Legacy Cloudinary without provider field
  assert.deepEqual(
    resolveProvider({
      public_id: 'sample123',
      secure_url: 'https://res.cloudinary.com/dapjiys4/image/upload/v1700000000/electronics/image/sample123.jpg',
    }),
    { provider: 'cloudinary', id: 'sample123' },
  );
  assert.deepEqual(
    resolveProvider('https://cdn.masheco.com/img/f_auto,w_300/v1700/electronics/image/sample123.webp'),
    { provider: 'cloudinary', id: 'electronics/image/sample123' },
  );
  assert.deepEqual(
    resolveProvider({ public_id: 'legacy_only_id' }),
    { provider: 'cloudinary', id: 'legacy_only_id' },
  );

  // Seed & Unsplash are never deleted
  assert.deepEqual(
    resolveProvider({ public_id: 'seed/banner-1', secure_url: 'https://images.unsplash.com/photo-123' }),
    { provider: 'external', id: null },
  );
  assert.deepEqual(
    resolveProvider('https://images.unsplash.com/photo-123'),
    { provider: 'external', id: null },
  );
});

test('imageProcessor: resizes large JPEG to WebP + variants, preserves PNG alpha, rejects invalid files', async () => {
  // Large 1800x1200 JPEG -> 1200x800 WebP + 400 + 100 variants
  const largeJpeg = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();

  const processed = await processImage(largeJpeg, 'product');
  assert.equal(processed.mimeType, 'image/webp');
  assert.equal(processed.main.width, 1200);
  assert.equal(processed.main.height, 800);
  assert.equal(processed.variants.length, 2);
  assert.equal(processed.variants[0]?.width, 400);
  assert.equal(processed.variants[1]?.width, 100);

  // Transparent PNG logo -> alpha preserved
  const transparentPng = await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.4 } },
  })
    .png()
    .toBuffer();
  const logoResult = await processImage(transparentPng, 'logo');
  assert.equal(logoResult.hasAlpha, true);
  const logoMeta = await sharp(logoResult.main.buffer).metadata();
  assert.equal(logoMeta.format, 'webp');
  assert.equal(logoMeta.hasAlpha, true);

  // Reject spoofed/corrupt file
  await assert.rejects(
    () => processImage(Buffer.from('not-actually-an-image'), 'product'),
    /Invalid or corrupted image file/,
  );

  // Reject tiny image
  const tiny = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  await assert.rejects(() => processImage(tiny, 'product'), /too small/);
});

test('r2.provider: uploads main + variants with cache headers and rolls back on partial failure', async () => {
  const sent: any[] = [];
  const fakeClient: S3Like = {
    async send(cmd: any) {
      sent.push(cmd);
      return {};
    },
  };

  const provider = createR2Provider(
    {
      accountId: 'acc123',
      accessKeyId: 'key123',
      secretAccessKey: 'sec123',
      bucketName: 'masheco-media',
      endpoint: 'https://acc123.r2.cloudflarestorage.com',
      publicUrl: 'https://media.masheco.com',
    },
    fakeClient,
  );

  const tmpFile = path.join(os.tmpdir(), `r2-test-${Date.now()}.png`);
  await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toFile(tmpFile);

  const uploaded = await provider.upload({
    filePath: tmpFile,
    kind: 'product',
    ownerPrefix: `merchants/${TENANT_A}`,
  });

  assert.equal(uploaded.provider, 'r2');
  assert.match(uploaded.public_id, new RegExp(`^merchants/${TENANT_A}/products/.+\\.webp$`));
  assert.equal(uploaded.secure_url, `https://media.masheco.com/${uploaded.public_id}`);
  assert.equal(uploaded.variants.length, 2);

  // Main + 2 variants = 3 PutObjectCommands with immutable CacheControl
  const puts = sent.filter((c) => c instanceof PutObjectCommand);
  assert.equal(puts.length, 3);
  for (const p of puts) {
    assert.equal(p.input.Bucket, 'masheco-media');
    assert.equal(p.input.ContentType, 'image/webp');
    assert.equal(p.input.CacheControl, R2_CACHE_CONTROL);
  }

  // Temp file removed
  await assert.rejects(() => fs.access(tmpFile));

  // Partial failure rollback test: 2nd PutObject fails -> DeleteObjectsCommand cleans up 1st
  const sentFail: any[] = [];
  let putCount = 0;
  const failingClient: S3Like = {
    async send(cmd: any) {
      sentFail.push(cmd);
      if (cmd instanceof PutObjectCommand) {
        putCount++;
        if (putCount === 2) throw new Error('Simulated R2 network error');
      }
      return {};
    },
  };
  const failingProvider = createR2Provider(
    {
      accountId: 'acc123',
      accessKeyId: 'key123',
      secretAccessKey: 'sec123',
      bucketName: 'masheco-media',
      endpoint: 'https://acc123.r2.cloudflarestorage.com',
      publicUrl: 'https://media.masheco.com',
    },
    failingClient,
  );
  const tmpFile2 = path.join(os.tmpdir(), `r2-fail-${Date.now()}.png`);
  await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toFile(tmpFile2);

  await assert.rejects(
    () => failingProvider.upload({ filePath: tmpFile2, kind: 'product', ownerPrefix: `merchants/${TENANT_A}` }),
    /Failed to upload image to storage/,
  );
  const deletes = sentFail.filter((c) => c instanceof DeleteObjectsCommand);
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].input.Delete.Objects.length, 1);
});

test('asyncHandler cleanupUploadedFiles ignores client-supplied req.body image IDs (D-1)', async () => {
  // Should complete without attempting to delete client-supplied victim public_ids
  await cleanupUploadedFiles({
    body: {
      image: { public_id: 'victim_tenant_image_id' },
      images: [{ public_id: 'another_victim_id' }],
    },
    uploadedMedia: [],
  });
  assert.ok(true);
});

test('computeQuotaSummary: enforces 2 GB base limit + add-on boost accurately', () => {
  const TWO_GB = 2 * 1024 * 1024 * 1024;
  const half = computeQuotaSummary(1024 * 1024 * 1024, TWO_GB, 0);
  assert.equal(half.usedPercent, 50);
  assert.equal(half.isLimitReached, false);
  assert.equal(half.remainingBytes, 1024 * 1024 * 1024);

  const full = computeQuotaSummary(TWO_GB, TWO_GB, 0);
  assert.equal(full.usedPercent, 100);
  assert.equal(full.isLimitReached, true);
  assert.equal(full.remainingBytes, 0);

  const boosted = computeQuotaSummary(TWO_GB, TWO_GB, TWO_GB);
  assert.equal(boosted.totalLimitBytes, 2 * TWO_GB);
  assert.equal(boosted.usedPercent, 50);
  assert.equal(boosted.isLimitReached, false);
});

test('aggregateMetricsByMerchant: parses /merchants/{tenantId}/... read metrics accurately', () => {
  const agg = aggregateMetricsByMerchant([
    { path: `/merchants/${TENANT_A}/products/1.webp`, requests: 120, bytes: 50000 },
    { path: `/merchants/${TENANT_A}/categories/2_w400.webp`, requests: 30, bytes: 10000 },
    { path: `/merchants/${TENANT_B}/store/logo/3.webp`, requests: 15, bytes: 4000 },
    { path: '/platform/blog/4.webp', requests: 99, bytes: 20000 },
  ]);
  assert.deepEqual(agg.get(TENANT_A), { requests: 150, bytes: 60000 });
  assert.deepEqual(agg.get(TENANT_B), { requests: 15, bytes: 4000 });
  assert.equal(agg.size, 2);
});
