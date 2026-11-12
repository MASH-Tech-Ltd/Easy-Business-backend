import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import ApiResponse from '../../utils/apiResponse';
import { BlockedPhoneService } from './blockedPhone.service';

const getBlockedPhones = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user.tenantId;
  const result = await BlockedPhoneService.getBlockedPhones(tenantId, req.query as any);
  ApiResponse.sendSuccess(res, 200, 'Blocked phone numbers retrieved successfully', result);
});

const blockPhone = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.userId || req.user._id;
  const result = await BlockedPhoneService.blockPhone(tenantId, userId, req.body);
  ApiResponse.sendSuccess(res, 201, 'Phone number blocked for your store', result);
});

const unblockPhone = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user.tenantId;
  const phone = Array.isArray(req.params.phone) ? req.params.phone[0] : req.params.phone;
  const result = await BlockedPhoneService.unblockPhone(tenantId, phone || '');
  ApiResponse.sendSuccess(res, 200, 'Phone number unblocked successfully', result);
});

export const BlockedPhoneController = {
  getBlockedPhones,
  blockPhone,
  unblockPhone,
};

