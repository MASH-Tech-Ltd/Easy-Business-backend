import { Request, Response } from 'express';
import { ReferralService } from './referral.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

// Public endpoint for registration code validation
const validateCode = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params;
  const result = await ReferralService.validateCode(code as string);
  ApiResponse.sendSuccess(res, 200, 'Referral code is valid', result);
});

// Admin management
const createReferral = asyncHandler(async (req: Request, res: Response) => {
  const result = await ReferralService.createReferral(req.body);
  ApiResponse.sendSuccess(res, 201, 'Referral code created successfully', result);
});

const getAllReferrals = asyncHandler(async (req: Request, res: Response) => {
  const result = await ReferralService.getAllReferrals(req.query);
  ApiResponse.sendSuccess(res, 200, 'Referral codes retrieved successfully', result);
});

const getReferralById = asyncHandler(async (req: Request, res: Response) => {
  const result = await ReferralService.getReferralById(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Referral code retrieved successfully', result);
});

const updateReferral = asyncHandler(async (req: Request, res: Response) => {
  const result = await ReferralService.updateReferral(req.params.id as string, req.body);
  ApiResponse.sendSuccess(res, 200, 'Referral code updated successfully', result);
});

const toggleStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await ReferralService.toggleStatus(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Referral code status toggled successfully', result);
});

const deleteReferral = asyncHandler(async (req: Request, res: Response) => {
  const result = await ReferralService.deleteReferral(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Referral code deleted successfully', result);
});

const getReferralUsages = asyncHandler(async (req: Request, res: Response) => {
  const result = await ReferralService.getReferralUsages(req.query);
  ApiResponse.sendSuccess(res, 200, 'Referral usages retrieved successfully', result);
});

// Merchant Refer & Earn endpoints
const getMyMerchantReferral = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user._id;
  const tenantId = (req as any).user.tenantId;
  const result = await ReferralService.getOrCreateMerchantReferral(userId, tenantId);
  ApiResponse.sendSuccess(res, 200, 'Merchant referral program details retrieved', result);
});

const requestPointsWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user._id;
  const tenantId = (req as any).user.tenantId;
  const result = await ReferralService.requestPointsWithdrawal(userId, tenantId, req.body);
  ApiResponse.sendSuccess(res, 201, 'Points withdrawal request submitted successfully', result);
});

// Admin Withdrawals management
const getAllWithdrawals = asyncHandler(async (req: Request, res: Response) => {
  const result = await ReferralService.getAllWithdrawals(req.query);
  ApiResponse.sendSuccess(res, 200, 'Withdrawals retrieved successfully', result);
});

const processWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, adminFeedback } = req.body;
  const result = await ReferralService.processWithdrawal(id as string, status, adminFeedback);
  ApiResponse.sendSuccess(res, 200, `Withdrawal request ${status} successfully`, result);
});

export const ReferralController = {
  validateCode,
  createReferral,
  getAllReferrals,
  getReferralById,
  updateReferral,
  toggleStatus,
  deleteReferral,
  getReferralUsages,
  // Merchant endpoints
  getMyMerchantReferral,
  requestPointsWithdrawal,
  // Admin withdrawal management
  getAllWithdrawals,
  processWithdrawal,
};
