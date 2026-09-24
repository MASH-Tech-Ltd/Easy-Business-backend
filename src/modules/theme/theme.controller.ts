import { Request, Response } from 'express';
import { ThemeService } from './theme.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { uploadCloudinary, deleteCloudinary } from '../../helpers/cloudinary';
import CustomError from '../../helpers/CustomError';

const updateTheme = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const payload = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body;
  
  if (payload.banner) {
    const b = payload.banner;
    const existingTheme = await ThemeService.getTheme(tenantId);
    const hasBannerImage = !!req.file || !!b.image?.secure_url || !!existingTheme?.banner?.image?.secure_url;
    const hasBannerContent = !!b.title || !!b.subtitle || !!b.description || !!b.buttonText || !!b.buttonLink || hasBannerImage;

    if (hasBannerContent) {
      if (!b.title || !b.subtitle || !b.description || !b.buttonText || !b.buttonLink || !hasBannerImage) {
        throw new CustomError(400, 'All banner fields (title, subtitle, description, button text, button link, and image) must be provided.');
      }
    }
  }

  if (req.file) {
    // Check for existing image to delete
    const existingTheme = await ThemeService.getTheme(tenantId);
    if (existingTheme?.banner?.image?.public_id) {
      try {
        await deleteCloudinary(existingTheme.banner.image.public_id, 'image');
      } catch (error) {
        console.error('Failed to delete old banner image from Cloudinary:', error);
      }
    }

    const uploadResult = await uploadCloudinary(req.file.path);
    payload.banner = payload.banner || {};
    payload.banner.image = {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url,
    };
  }
  
  const result = await ThemeService.updateTheme(tenantId, payload);
  ApiResponse.sendSuccess(res, 200, 'Theme updated successfully', result);
});

const getMyTheme = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await ThemeService.getTheme(tenantId);
  ApiResponse.sendSuccess(res, 200, 'Theme retrieved successfully', result);
});

export const ThemeController = {
  updateTheme,
  getMyTheme,
};
