import { Request, Response } from 'express';
import { ThemeService } from './theme.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { MediaService } from '../media/media.service';
import CustomError from '../../helpers/CustomError';
import { CacheInvalidation } from '../../services/cache/cache.invalidation';

const isValidBDPhone = (phone?: string): boolean => {
  if (!phone || !phone.trim()) return true;
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  return /^(?:\+?88|88)?01[3-9]\d{8}$/.test(cleanPhone);
};

const updateTheme = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const payload = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body;

  // Validate footer contact phone
  if (payload.footer?.contactInfo?.phone && !isValidBDPhone(payload.footer.contactInfo.phone)) {
    throw new CustomError(400, "Invalid Bangladeshi phone number in Footer Contact Info. Must be a valid 11-digit BD number (e.g. 01XXXXXXXXXX).");
  }

  const existingTheme = await ThemeService.getTheme(tenantId);
  
  // Extract files from upload.fields
  const filesObj = (req.files as { [fieldname: string]: Express.Multer.File[] }) || {};
  const bannerImagesFiles: Express.Multer.File[] = [
    ...(filesObj['bannerImages'] || []),
    ...(filesObj['bannerImage'] || [])
  ];

  // Process existing images / slots retained by client
  const imageSlots: any[] = Array.isArray(payload.banner?.imageSlots)
    ? payload.banner.imageSlots
    : Array.isArray(payload.banner?.existingImages)
    ? payload.banner.existingImages
    : Array.isArray(payload.banner?.images)
    ? payload.banner.images
    : payload.banner?.image
    ? [payload.banner.image]
    : [];

  // Upload new files via MediaService
  const newUploadedImages: Array<{ public_id: string; secure_url: string; provider?: 'cloudinary' | 'r2' }> = [];
  for (const file of bannerImagesFiles) {
    const uploadResult = await MediaService.uploadImage(req, file.path, {
      tenantId,
      kind: 'banner',
    });
    newUploadedImages.push({
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url,
      provider: uploadResult.provider,
    });
  }

  // Build map of existing banner images in DB to validate retained slots (prevents foreign public_id injection)
  const dbBannerImages: Array<{ public_id?: string; secure_url?: string; provider?: 'cloudinary' | 'r2' }> = [
    ...(existingTheme?.banner?.images || []),
    ...(existingTheme?.banner?.image?.public_id || existingTheme?.banner?.image?.secure_url
      ? [existingTheme.banner.image]
      : []),
  ];
  const dbBannerByUrl = new Map<string, any>();
  const dbBannerById = new Map<string, any>();
  for (const dbImg of dbBannerImages) {
    if (dbImg?.secure_url) dbBannerByUrl.set(dbImg.secure_url, dbImg);
    if (dbImg?.public_id) dbBannerById.set(dbImg.public_id, dbImg);
  }

  // Reconstruct finalBannerImages respecting slot positions
  let fileCursor = 0;
  const finalBannerImages: Array<{ public_id: string; secure_url: string; provider?: 'cloudinary' | 'r2' }> = [];

  for (const slot of imageSlots) {
    if (finalBannerImages.length >= 3) break;
    if (slot?.isNew) {
      if (fileCursor < newUploadedImages.length) {
        finalBannerImages.push(newUploadedImages[fileCursor]!);
        fileCursor++;
      }
    } else if (slot?.public_id || slot?.secure_url) {
      const matched =
        (slot.secure_url && dbBannerByUrl.get(slot.secure_url)) ||
        (slot.public_id && dbBannerById.get(slot.public_id));
      if (matched && matched.public_id && matched.secure_url) {
        finalBannerImages.push({
          public_id: matched.public_id,
          secure_url: matched.secure_url,
          ...(matched.provider ? { provider: matched.provider } : {}),
        });
      }
    }
  }

  // Append any extra uploaded files if slots didn't exhaust them
  while (fileCursor < newUploadedImages.length && finalBannerImages.length < 3) {
    finalBannerImages.push(newUploadedImages[fileCursor]!);
    fileCursor++;
  }

  // Identify removed images for cleanup AFTER database update succeeds
  const retainedPublicIds = new Set(finalBannerImages.map(img => img.public_id).filter(Boolean));
  const bannerImagesToDelete: any[] = [];

  for (const oldImg of dbBannerImages) {
    if (oldImg?.public_id && !retainedPublicIds.has(oldImg.public_id)) {
      bannerImagesToDelete.push(oldImg);
    }
  }

  if (payload.banner) {
    payload.banner.images = finalBannerImages;
    payload.banner.image = finalBannerImages[0] || { public_id: '', secure_url: '' };
    delete payload.banner.imageSlots;
    delete payload.banner.existingImages;

    const b = payload.banner;
    const hasBannerImages = finalBannerImages.length > 0;
    const isContentVisible = b.showBannerContent !== false;

    if (isContentVisible) {
      const hasAnyContent = !!b.title || !!b.subtitle || !!b.description || !!b.buttonText || !!b.buttonLink;
      if (hasAnyContent && (!b.title || !b.subtitle || !b.description || !b.buttonText || !b.buttonLink || !hasBannerImages)) {
        throw new CustomError(400, 'All banner fields (title, subtitle, description, button text, button link, and at least 1 image) must be provided.');
      }
    }
  }
  
  const result = await ThemeService.updateTheme(tenantId, payload);

  // Delete old banner images ONLY AFTER successful database update
  if (bannerImagesToDelete.length > 0) {
    MediaService.deleteImages(bannerImagesToDelete, { tenantId, reason: 'theme_banner_update' }).catch((err) =>
      console.error('Failed to delete old banner images:', err)
    );
  }

  void CacheInvalidation.invalidateStoreSettings(String(tenantId));
  void CacheInvalidation.invalidateMerchantDashboard(String(tenantId));

  ApiResponse.sendSuccess(res, 200, 'Theme updated successfully', result);
});

const getMyTheme = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await ThemeService.getTheme(tenantId);
  ApiResponse.sendSuccess(res, 200, 'Theme retrieved successfully', result);
});

const getThemePreviews = asyncHandler(async (req: Request, res: Response) => {
  const { GlobalSetting } = await import('../system/globalSetting.model');
  const settings = await GlobalSetting.findOne();
  const themePreviews = settings?.themePreviews || {
    'design-01': '',
    'design-02': '',
    'design-03': '',
    'design-04': '',
    'design-05': '',
    'design-06': '',
  };
  ApiResponse.sendSuccess(res, 200, 'Theme preview links retrieved', themePreviews);
});

export const ThemeController = {
  updateTheme,
  getMyTheme,
  getThemePreviews,
};
