import fs from 'fs/promises';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import config from '../../../config';
import CustomError from '../../../helpers/CustomError';
import { MediaProvider, ProviderDeleteResult, ProviderUploadInput, UploadedMedia, MediaVariant } from '../media.interface';
import { processImage } from '../utils/imageProcessor';
import { buildMediaKey, buildVariantKey, isSafeKey } from '../utils/mediaKey';

/** Objects are immutable (new UUID key on every change) — safe for long-lived CDN/browser caching. */
export const R2_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Minimal client surface so tests can inject a fake without extra dependencies. */
export interface S3Like {
  send(command: any): Promise<any>;
}

export interface R2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
  publicUrl: string;
}

export const resolveR2Endpoint = (s: Pick<R2Settings, 'endpoint' | 'accountId'>): string =>
  s.endpoint || (s.accountId ? `https://${s.accountId}.r2.cloudflarestorage.com` : '');

export const isR2Configured = (s: R2Settings): boolean =>
  Boolean(s.accessKeyId && s.secretAccessKey && s.bucketName && resolveR2Endpoint(s) && s.publicUrl);

const safeErrorMessage = (error: any): string =>
  // Never echo request signatures/credentials — the SDK error name + message is enough
  `${error?.name || 'Error'}: ${String(error?.message || 'unknown').slice(0, 200)}`;

export const createR2Provider = (
  settings: R2Settings = config.r2,
  clientOverride?: S3Like,
): MediaProvider => {
  let client: S3Like | undefined = clientOverride;

  const getClient = (): S3Like => {
    if (client) return client;
    if (!isR2Configured(settings)) {
      throw new CustomError(500, 'Media storage is not configured.');
    }
    client = new S3Client({
      region: 'auto',
      endpoint: resolveR2Endpoint(settings),
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      // R2 compatibility: only send checksums when the operation requires them
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 3,
    });
    return client;
  };

  const getPublicUrl = (key: string) => `${settings.publicUrl}/${key}`;

  const putObject = async (key: string, body: Buffer, contentType: string) => {
    if (!isSafeKey(key)) throw new CustomError(500, 'Refusing to write unsafe media key');
    await getClient().send(
      new PutObjectCommand({
        Bucket: settings.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
        CacheControl: R2_CACHE_CONTROL,
      }),
    );
  };

  const deleteKeys = async (keys: string[]): Promise<ProviderDeleteResult> => {
    const safe = Array.from(new Set(keys.filter(isSafeKey)));
    const result: ProviderDeleteResult = { deleted: [], failed: [] };
    for (let i = 0; i < safe.length; i += 1000) {
      const chunk = safe.slice(i, i + 1000);
      try {
        const res = await getClient().send(
          new DeleteObjectsCommand({
            Bucket: settings.bucketName,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        const errors: Array<{ Key?: string; Message?: string; Code?: string }> = res?.Errors || [];
        const failedKeys = new Set(errors.map((e) => e.Key).filter(Boolean) as string[]);
        errors.forEach((e) => {
          if (e.Key) result.failed.push({ id: e.Key, error: `${e.Code || 'Error'}: ${e.Message || ''}`.trim() });
        });
        chunk.forEach((k) => {
          if (!failedKeys.has(k)) result.deleted.push(k);
        });
      } catch (error) {
        const msg = safeErrorMessage(error);
        chunk.forEach((id) => result.failed.push({ id, error: msg }));
      }
    }
    return result;
  };

  return {
    name: 'r2',

    isConfigured: () => Boolean(clientOverride) || isR2Configured(settings),

    async upload({ filePath, kind, ownerPrefix }: ProviderUploadInput): Promise<UploadedMedia> {
      let input: Buffer;
      try {
        if (!filePath) throw new Error('missing');
        input = await fs.readFile(filePath);
      } catch {
        throw new CustomError(400, 'Image path missing');
      } finally {
        // Temp file is no longer needed once read (or if unreadable)
        if (filePath) await fs.unlink(filePath).catch(() => {});
      }

      const processed = await processImage(input, kind);
      const mainKey = buildMediaKey(ownerPrefix, kind);
      const written: string[] = [];

      try {
        await putObject(mainKey, processed.main.buffer, processed.mimeType);
        written.push(mainKey);

        const variants: MediaVariant[] = [];
        for (const v of processed.variants) {
          const vKey = buildVariantKey(mainKey, v.variantWidth);
          await putObject(vKey, v.buffer, processed.mimeType);
          written.push(vKey);
          variants.push({ key: vKey, width: v.width, height: v.height, bytes: v.bytes });
        }

        const totalBytes = processed.main.bytes + variants.reduce((s, v) => s + v.bytes, 0);
        return {
          provider: 'r2',
          public_id: mainKey,
          secure_url: getPublicUrl(mainKey),
          mimeType: processed.mimeType,
          bytes: processed.main.bytes,
          totalBytes,
          width: processed.main.width,
          height: processed.main.height,
          variants,
        };
      } catch (error) {
        // Partial write: remove whatever was stored so no orphan objects remain
        if (written.length) await deleteKeys(written).catch(() => undefined);
        if (error instanceof CustomError) throw error;
        console.error('[media:r2] upload failed:', safeErrorMessage(error));
        throw new CustomError(502, 'Failed to upload image to storage. Please try again.');
      }
    },

    delete: deleteKeys,

    getPublicUrl,
  };
};
