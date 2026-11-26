import fs from 'fs';
import {
  uploadCloudinary,
  deleteMultipleCloudinary,
} from '../../../helpers/cloudinary';
import config from '../../../config';
import { MediaProvider, ProviderDeleteResult, ProviderUploadInput, UploadedMedia } from '../media.interface';

/**
 * Thin adapter over the existing helpers/cloudinary.ts. Upload behaviour (folder, quality,
 * 1280px limit, short public_id) is exactly the legacy behaviour.
 */
export const createCloudinaryProvider = (): MediaProvider => ({
  name: 'cloudinary',

  isConfigured: () =>
    Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret),

  async upload({ filePath }: ProviderUploadInput): Promise<UploadedMedia> {
    const result = await uploadCloudinary(filePath);
    const bytes = typeof result.bytes === 'number' ? result.bytes : null;
    return {
      provider: 'cloudinary',
      public_id: result.public_id,
      secure_url: result.secure_url,
      mimeType: result.format ? `image/${result.format === 'jpg' ? 'jpeg' : result.format}` : 'image/*',
      bytes,
      totalBytes: bytes,
      width: typeof result.width === 'number' ? result.width : null,
      height: typeof result.height === 'number' ? result.height : null,
      variants: [],
    };
  },

  async delete(ids: string[]): Promise<ProviderDeleteResult> {
    const valid = ids.filter((id) => typeof id === 'string' && id.trim().length > 0);
    if (valid.length === 0) return { deleted: [], failed: [] };
    try {
      // Legacy helper already chunks + falls back to individual destroy calls
      await deleteMultipleCloudinary(valid, 'image');
      return { deleted: valid, failed: [] };
    } catch (error: any) {
      return { deleted: [], failed: valid.map((id) => ({ id, error: error?.message || 'Cloudinary delete failed' })) };
    }
  },

  getPublicUrl: (id: string) => id, // Cloudinary URLs are always stored in full (secure_url)
});

/** Ensure temp file is gone even if a caller bails out before upload. */
export const removeTempFile = (filePath?: string) => {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* asyncHandler sweeps leftovers */
  }
};
