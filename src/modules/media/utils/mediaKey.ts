import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import CustomError from '../../../helpers/CustomError';
import { MediaKind } from '../media.interface';

/**
 * Object key layout (R2):
 *   merchants/{tenantId}/products/{uuid}.webp
 *   merchants/{tenantId}/categories/{uuid}.webp
 *   merchants/{tenantId}/store/logo/{uuid}.webp
 *   merchants/{tenantId}/store/banners/{uuid}.webp
 *   merchants/{tenantId}/avatars/{uuid}.webp
 *   platform/blog/{uuid}.webp
 *   platform/avatars/{uuid}.webp
 * Variants are siblings: {uuid}_w400.webp, {uuid}_w100.webp
 *
 * No segment is derived from client input except the tenantId, which always comes from the
 * verified JWT and is validated as an ObjectId — so path traversal is impossible.
 */

export const VARIANT_WIDTHS = [400, 100] as const;

const KIND_FOLDERS: Record<MediaKind, string> = {
  product: 'products',
  category: 'categories',
  logo: 'store/logo',
  banner: 'store/banners',
  avatar: 'avatars',
  blog: 'blog',
};

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MAIN_KEY_RE = new RegExp(`^(.+/${UUID_RE})\\.webp$`, 'i');
const ANY_KEY_RE = new RegExp(`^(.+/${UUID_RE})(?:_w\\d+)?\\.webp$`, 'i');

export const buildOwnerPrefix = (tenantId: string | null | undefined): string => {
  if (tenantId === null || tenantId === undefined || tenantId === '') return 'platform';
  const id = String(tenantId);
  if (!Types.ObjectId.isValid(id) || !/^[0-9a-f]{24}$/i.test(id)) {
    throw new CustomError(400, 'Invalid tenant context for media upload');
  }
  return `merchants/${id.toLowerCase()}`;
};

export const buildMediaKey = (ownerPrefix: string, kind: MediaKind, uuid: string = randomUUID()): string => {
  if (!/^(platform|merchants\/[0-9a-f]{24})$/.test(ownerPrefix)) {
    throw new CustomError(400, 'Invalid media owner prefix');
  }
  const folder = KIND_FOLDERS[kind];
  if (!folder) throw new CustomError(400, 'Invalid media kind');
  return `${ownerPrefix}/${folder}/${uuid}.webp`;
};

export const buildVariantKey = (mainKey: string, width: number): string => {
  const m = MAIN_KEY_RE.exec(mainKey);
  if (!m) throw new CustomError(500, 'Cannot derive variant key from non-standard media key');
  return `${m[1]}_w${width}.webp`;
};

/** Returns main key + all variant keys for a key we generated (variant or main input). */
export const expandWithVariantKeys = (key: string): string[] => {
  const m = ANY_KEY_RE.exec(key);
  if (!m) return [key];
  const base = m[1];
  return [`${base}.webp`, ...VARIANT_WIDTHS.map((w) => `${base}_w${w}.webp`)];
};

/** Structural safety check for any key we are about to send to the storage API. */
export const isSafeKey = (key: unknown): key is string =>
  typeof key === 'string' &&
  key.length > 0 &&
  key.length <= 512 &&
  !key.startsWith('/') &&
  !key.includes('\\') &&
  !key.includes('..') &&
  !key.includes('//') &&
  /^[A-Za-z0-9/_.-]+$/.test(key);

/**
 * Ownership guard: a tenant may only touch keys under `merchants/{ownTenantId}/`,
 * platform (super admin) operations only keys under `platform/`.
 */
export const isKeyOwnedBy = (key: string, tenantId: string | null | undefined): boolean => {
  if (!isSafeKey(key)) return false;
  let prefix: string;
  try {
    prefix = buildOwnerPrefix(tenantId);
  } catch {
    return false;
  }
  return key.startsWith(`${prefix}/`);
};
