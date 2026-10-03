import { Request, Response } from 'express';
import { ThemeService } from './theme.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { uploadCloudinary, deleteCloudinary } from '../../helpers/cloudinary';
import CustomError from '../../helpers/CustomError';

const updateTheme = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const payload = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body;
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

  // Upload new files to Cloudinary
  const newUploadedImages: Array<{ public_id: string; secure_url: string }> = [];
  for (const file of bannerImagesFiles) {
    try {
      const uploadResult = await uploadCloudinary(file.path);
      newUploadedImages.push({
        public_id: uploadResult.public_id,
        secure_url: uploadResult.secure_url,
      });
    } catch (error) {
      console.error('Failed to upload banner image to Cloudinary:', error);
    }
  }

  // Reconstruct finalBannerImages respecting slot positions
  let fileCursor = 0;
  const finalBannerImages: Array<{ public_id: string; secure_url: string }> = [];

  for (const slot of imageSlots) {
    if (finalBannerImages.length >= 3) break;
    if (slot?.isNew) {
      if (fileCursor < newUploadedImages.length) {
        finalBannerImages.push(newUploadedImages[fileCursor]!);
        fileCursor++;
      }
    } else if (slot?.public_id && slot?.secure_url) {
      finalBannerImages.push({
        public_id: slot.public_id,
        secure_url: slot.secure_url,
      });
    }
  }

  // Append any extra uploaded files if slots didn't exhaust them
  while (fileCursor < newUploadedImages.length && finalBannerImages.length < 3) {
    finalBannerImages.push(newUploadedImages[fileCursor]!);
    fileCursor++;
  }

  // Identify removed images for Cloudinary cleanup AFTER database update succeeds
  const oldImages: Array<{ public_id?: string }> = [
    ...(existingTheme?.banner?.images || []),
    ...(existingTheme?.banner?.image?.public_id ? [existingTheme.banner.image] : [])
  ];
  const retainedPublicIds = new Set(finalBannerImages.map(img => img.public_id).filter(Boolean));
  const bannerImagesToDelete: string[] = [];

  for (const oldImg of oldImages) {
    if (oldImg?.public_id && !retainedPublicIds.has(oldImg.public_id)) {
      bannerImagesToDelete.push(oldImg.public_id);
    }
  }

  if (payload.banner) {
    payload.banner.images = finalBannerImages;
    payload.banner.image = finalBannerImages[0] || { public_id: '', secure_url: '' };
    delete payload.banner.imageSlots;
    delete payload.banner.existingImages;

    const b = payload.banner;
    const hasBannerImages = finalBannerImages.length > 0;
    const hasBannerContent = !!b.title || !!b.subtitle || !!b.description || !!b.buttonText || !!b.buttonLink || hasBannerImages;

    if (hasBannerContent) {
      if (!b.title || !b.subtitle || !b.description || !b.buttonText || !b.buttonLink || !hasBannerImages) {
        throw new CustomError(400, 'All banner fields (title, subtitle, description, button text, button link, and at least 1 image) must be provided.');
      }
    }
  }
  
  const result = await ThemeService.updateTheme(tenantId, payload);

  // Delete old banner images ONLY AFTER successful database update
  if (bannerImagesToDelete.length > 0) {
    for (const publicId of bannerImagesToDelete) {
      deleteCloudinary(publicId, 'image').catch((err) => console.error('Failed to delete old banner image from Cloudinary:', err));
    }
  }

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
  };
  ApiResponse.sendSuccess(res, 200, 'Theme preview links retrieved', themePreviews);
});

export const ThemeController = {
  updateTheme,
  getMyTheme,
  getThemePreviews,
};
