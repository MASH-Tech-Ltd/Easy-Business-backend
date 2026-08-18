import { Request, Response } from 'express';
import { FraudCheckService } from './fraudCheck.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const checkFraud = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.body;
  const tenantId = (req as any).user.tenantId;

  if (!orderId) {
    return ApiResponse.sendError(res, 400, 'Order ID is required');
  }

  const result = await FraudCheckService.checkFraud(orderId, tenantId);
  ApiResponse.sendSuccess(res, 200, 'Fraud check completed', result);
});

const getMerchantFraudChecks = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await FraudCheckService.getMerchantFraudChecks(tenantId);
  ApiResponse.sendSuccess(res, 200, 'Fraud checks retrieved', result);
});

const getAllFraudChecks = asyncHandler(async (req: Request, res: Response) => {
  const result = await FraudCheckService.getAllFraudChecks();
  ApiResponse.sendSuccess(res, 200, 'All fraud checks retrieved', result);
});

export const FraudCheckController = {
  checkFraud,
  getMerchantFraudChecks,
  getAllFraudChecks,
};
