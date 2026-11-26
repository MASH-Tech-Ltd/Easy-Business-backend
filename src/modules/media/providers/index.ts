import config from '../../../config';
import { ImageLike, MediaProvider, MediaProviderName } from '../media.interface';
import { createCloudinaryProvider } from './cloudinary.provider';
import { createR2Provider } from './r2.provider';

const cloudinaryProvider = createCloudinaryProvider();
const r2Provider = createR2Provider();

const PROVIDERS: Record<MediaProviderName, MediaProvider> = {
  cloudinary: cloudinaryProvider,
  r2: r2Provider,
};

export const getProvider = (name: MediaProviderName): MediaProvider => PROVIDERS[name];

/**
 * Selects the active storage provider for NEW uploads based on MEDIA_STORAGE_PROVIDER.
 * If set to 'r2' but R2 credentials/endpoint are incomplete, logs a clear error and
 * falls back to Cloudinary rather than crashing production.
 */
export const getUploadProvider = (override?: MediaProviderName): MediaProvider => {
  const requested = (override || config.media.storageProvider) as string;
  if (requested === 'r2') {
    if (r2Provider.isConfigured()) return r2Provider;
    console.error(
      '[media] MEDIA_STORAGE_PROVIDER=r2 is set, but R2 configuration is incomplete. Falling back to cloudinary.',
    );
    return cloudinaryProvider;
  }
  return cloudinaryProvider;
};

/**
 * Validates media storage configuration at startup (logs warning/error, never crashes).
 */
export const validateMediaConfig = (): void => {
  if (config.media.storageProvider === 'r2' && !r2Provider.isConfigured()) {
    console.error(
      '[FATAL CONFIG] MEDIA_STORAGE_PROVIDER=r2 is enabled, but one or more R2_* environment variables are missing. New uploads will fall back to Cloudinary until R2 is configured.',
    );
  }
};

export interface ResolvedImageTarget {
  provider: MediaProviderName | 'external';
  /** Provider-specific identifier: R2 object key or Cloudinary public_id (or null if unresolvable). */
  id: string | null;
}

const isSeedOrExternalUrl = (url: string): boolean => {
  if (!url) return false;
  if (url.includes('unsplash.com') || url.includes('placehold.co')) return true;
  return false;
};

const extractR2KeyFromUrl = (url: string): string | null => {
  const base = config.r2.publicUrl;
  const bases = [base, 'https://media.masheco.com', 'http://media.masheco.com'].filter(Boolean);
  for (const b of bases) {
    const normalized = b.replace(/\/+$/, '') + '/';
    if (url.startsWith(normalized)) {
      const rest = url.slice(normalized.length).split('?')[0]?.split('#')[0] || '';
      return rest || null;
    }
  }
  return null;
};

const extractCloudinaryIdFromUrl = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  // Direct Cloudinary URL
  if (url.includes('cloudinary.com') && url.includes('/upload/')) {
    const parts = url.split('/upload/');
    if (parts.length < 2 || !parts[1]) return null;
    let p = parts[1].replace(/^v\d+\//, '');
    const dotIdx = p.lastIndexOf('.');
    if (dotIdx !== -1) p = p.substring(0, dotIdx);
    return p || null;
  }
  // Proxied cdn.masheco.com/img/... URL
  if (url.includes('cdn.masheco.com/img/')) {
    const parts = url.split('/img/');
    if (parts.length < 2 || !parts[1]) return null;
    // Strip any transform segments before v1234/ or folder/
    let p = parts[1].replace(/^((?:(?:[a-z]{1,4}_[^,/]+|f_auto|q_auto[^,/]*)[,;]?)+\/)+/i, '');
    p = p.replace(/^v\d+\//, '');
    const dotIdx = p.lastIndexOf('.');
    if (dotIdx !== -1) p = p.substring(0, dotIdx);
    return p || null;
  }
  return null;
};

/**
 * Determines which provider owns an existing image reference.
 * Precedence:
 *   1. Seed placeholder (`seed/...`) or external URL (Unsplash, placehold.co) -> 'external' (never delete)
 *   2. Explicit `provider` field ('r2' | 'cloudinary')
 *   3. URL host inference (`media.masheco.com` / R2_PUBLIC_URL -> 'r2', `cloudinary.com` / `cdn.masheco.com` -> 'cloudinary')
 *   4. Bare `public_id` without `provider` or recognized URL -> 'cloudinary' (legacy compatibility)
 */
export const resolveProvider = (image: ImageLike): ResolvedImageTarget => {
  if (!image) return { provider: 'external', id: null };

  const url =
    typeof image === 'string'
      ? image.trim()
      : (image.secure_url || '').trim();
  const publicId =
    typeof image === 'string'
      ? ''
      : (image.public_id || '').trim();
  const explicitProvider =
    typeof image === 'string'
      ? undefined
      : (image.provider as string | undefined);

  if (publicId.startsWith('seed/') || isSeedOrExternalUrl(url)) {
    return { provider: 'external', id: null };
  }

  // Check R2 URL first
  const r2KeyFromUrl = url ? extractR2KeyFromUrl(url) : null;
  if (explicitProvider === 'r2' || r2KeyFromUrl) {
    const key = publicId || r2KeyFromUrl;
    return { provider: 'r2', id: key || null };
  }

  // Check Cloudinary URL
  const cloudinaryIdFromUrl = url ? extractCloudinaryIdFromUrl(url) : null;
  if (explicitProvider === 'cloudinary' || cloudinaryIdFromUrl) {
    const id = publicId || cloudinaryIdFromUrl;
    return { provider: 'cloudinary', id: id || null };
  }

  // If URL is some other external host (e.g. pasted URL), do not touch
  if (url && /^https?:\/\//i.test(url)) {
    return { provider: 'external', id: null };
  }

  // Legacy bare public_id without URL or provider -> assume Cloudinary
  if (publicId) {
    // Safety: if a bare public_id looks like an R2 key, route to r2
    if (/^(merchants\/[0-9a-f]{24}|platform)\//i.test(publicId)) {
      return { provider: 'r2', id: publicId };
    }
    return { provider: 'cloudinary', id: publicId };
  }

  return { provider: 'external', id: null };
};
