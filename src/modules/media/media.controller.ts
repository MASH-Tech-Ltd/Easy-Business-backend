import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import CustomError from '../../helpers/CustomError';
import { MediaService, getCurrentMonthKey } from './media.service';
import {
  scanTenantCloudinaryMedia,
  migrateTenantMediaToR2,
  cleanupMigratedCloudinary,
  getMigrationHistory,
} from './mediaMigration.service';
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

const scanMigration = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId || '');
  if (!Types.ObjectId.isValid(tenantId)) throw new CustomError(400, 'Invalid tenant ID');
  ApiResponse.sendSuccess(res, 200, 'Cloudinary media scan completed', await scanTenantCloudinaryMedia(tenantId));
});

const runMigration = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId || '');
  if (!Types.ObjectId.isValid(tenantId)) throw new CustomError(400, 'Invalid tenant ID');
  const kinds = Array.isArray(req.body?.kinds) ? req.body.kinds : undefined;
  const limit = req.body?.limit ? Number(req.body.limit) : 10;
  const actorId = (req as any).user?._id ? String((req as any).user._id) : null;
  ApiResponse.sendSuccess(res, 200, 'Media migration chunk completed', await migrateTenantMediaToR2(tenantId, kinds, limit, actorId));
});

const cleanupMigration = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId || '');
  if (!Types.ObjectId.isValid(tenantId)) throw new CustomError(400, 'Invalid tenant ID');
  const force = Boolean(req.body?.force);
  ApiResponse.sendSuccess(res, 200, 'Cloudinary cleanup completed', await cleanupMigratedCloudinary(tenantId, force));
});

const migrationHistory = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId || '');
  if (!Types.ObjectId.isValid(tenantId)) throw new CustomError(400, 'Invalid tenant ID');
  ApiResponse.sendSuccess(res, 200, 'Migration history retrieved', await getMigrationHistory(tenantId));
});

export const MediaController = {
  getMyUsage,
  getPlatformUsage,
  getTenantUsage,
  scanMigration,
  runMigration,
  cleanupMigration,
  migrationHistory,
};
