import { Request, Response } from 'express';
import { ThemeService } from './theme.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const updateTheme = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await ThemeService.updateTheme(tenantId, req.body);
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
