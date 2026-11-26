import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import CustomError from '../../helpers/CustomError';
import { MediaService, getCurrentMonthKey } from './media.service';
import { Types } from 'mongoose';

const parseMonth = (raw: unknown): string => {
  if (typeof raw === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.trim())) {
    return raw.trim();
  }
  return getCurrentMonthKey();
};

const getMyUsage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  if (!tenantId) {
    throw new CustomError(400, 'Tenant context is required');
  }
  const month = parseMonth(req.query.month);
  const result = await MediaService.getMerchantUsage(String(tenantId), month);
  ApiResponse.sendSuccess(res, 200, 'Media usage retrieved successfully', result);
});

const getPlatformUsage = asyncHandler(async (req: Request, res: Response) => {
  const month = parseMonth(req.query.month);
  const result = await MediaService.getPlatformUsage(month);
  ApiResponse.sendSuccess(res, 200, 'Platform media usage retrieved successfully', result);
});

const getTenantUsage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId || '');
  if (!Types.ObjectId.isValid(tenantId)) {
    throw new CustomError(400, 'Invalid tenant ID');
  }
  const month = parseMonth(req.query.month);
  const result = await MediaService.getMerchantUsage(tenantId, month);
  ApiResponse.sendSuccess(res, 200, 'Tenant media usage retrieved successfully', result);
});

export const MediaController = {
  getMyUsage,
  getPlatformUsage,
  getTenantUsage,
};
