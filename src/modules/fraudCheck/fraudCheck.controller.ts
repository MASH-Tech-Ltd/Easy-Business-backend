import { Request, Response, NextFunction } from 'express';
import { FraudCheckService } from './fraudCheck.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const checkFraud = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, force } = req.body;
  const tenantId = (req as any).user.tenantId;

  if (!orderId) {
    return ApiResponse.sendError(res, 400, 'Order ID is required');
  }

  const result = await FraudCheckService.checkFraud(orderId, tenantId, !!force);
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

const getCustomerStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const stats = await FraudCheckService.getCustomerStats(phone as string);
    res.status(200).json({
      success: true,
      message: 'Customer stats retrieved successfully',
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

export const FraudCheckController = {
  checkFraud,
  getMerchantFraudChecks,
  getAllFraudChecks,
  getCustomerStats,
};
