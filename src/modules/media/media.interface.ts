export type MediaProviderName = 'cloudinary' | 'r2';

export const MEDIA_PROVIDERS: MediaProviderName[] = ['cloudinary', 'r2'];

/** Business context of an uploaded image. Determines processing profile and object key folder. */
export type MediaKind = 'product' | 'category' | 'logo' | 'banner' | 'avatar' | 'blog';

export const MEDIA_KINDS: MediaKind[] = ['product', 'category', 'logo', 'banner', 'avatar', 'blog'];

/**
 * Image reference as embedded in business documents (Product.images[], Category.image, ...).
 * Shape is backward compatible with legacy Cloudinary records: `provider` is optional and
 * resolved from the URL when missing.
 *   - cloudinary: public_id = Cloudinary public id (legacy short form), secure_url = Cloudinary URL
 *   - r2:         public_id = object key,                          secure_url = R2_PUBLIC_URL/key
 */
export interface StoredImageRef {
  public_id: string;
  secure_url: string;
  provider?: MediaProviderName;
}

/** Anything that can identify a stored image: a ref object, a bare URL, or null/undefined. */
export type ImageLike =
  | { public_id?: string | null; secure_url?: string | null; provider?: string | null }
  | string
  | null
  | undefined;

export interface MediaVariant {
  key: string;
  width: number;
  height: number;
  bytes: number;
}

export interface UploadedMedia {
  provider: MediaProviderName;
  public_id: string;
  secure_url: string;
  mimeType: string;
  /** Bytes of the main stored object (null when the provider does not report it). */
  bytes: number | null;
  /** Bytes of main object + all variants. */
  totalBytes: number | null;
  width: number | null;
  height: number | null;
  variants: MediaVariant[];
}

export interface ProviderUploadInput {
  filePath: string;
  kind: MediaKind;
  /** Owner prefix, e.g. `merchants/<tenantId>` or `platform`. Only used by key-based providers. */
  ownerPrefix: string;
}

export interface ProviderDeleteResult {
  deleted: string[];
  failed: Array<{ id: string; error: string }>;
}

export interface MediaProvider {
  readonly name: MediaProviderName;
  isConfigured(): boolean;
  upload(input: ProviderUploadInput): Promise<UploadedMedia>;
  /** Delete by provider identifier (Cloudinary public id or R2 key). Must not throw. */
  delete(ids: string[]): Promise<ProviderDeleteResult>;
  getPublicUrl(id: string): string;
}

/** Upload made during the current request, tracked server-side for failure cleanup. */
export interface TrackedUpload {
  provider: MediaProviderName;
  public_id: string;
  secure_url: string;
  tenantId: string | null;
}

export interface UploadContext {
  tenantId: string | null | undefined;
  kind: MediaKind;
  userId?: string | null | undefined;
}

export interface DeleteContext {
  /** Owner of the images. R2 keys outside this owner's prefix are refused. null = platform. */
  tenantId: string | null | undefined;
  reason?: string;
}

export interface DeleteSummary {
  requested: number;
  deleted: number;
  skipped: number;
  refused: number;
  queuedForRetry: number;
}
