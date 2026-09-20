import { Request, Response } from 'express';
import { CourierService } from './courier.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const getMyCourierCharge = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  const result = await CourierService.getCourierChargeByTenant(tenantId);
  ApiResponse.sendSuccess(res, 200, 'Courier charges retrieved', result);
});

const getStorefrontCourierCharge = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const result = await CourierService.getCourierChargeByTenant(tenantId as string);
  ApiResponse.sendSuccess(res, 200, 'Courier charges retrieved', result);
});

const updateCourierCharge = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  const result = await CourierService.updateCourierCharge(tenantId, req.body);
  ApiResponse.sendSuccess(res, 200, 'Courier charges updated successfully', result);
});

const saveCredentials = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  const result = await CourierService.saveCredentials(tenantId, req.body);
  ApiResponse.sendSuccess(res, 200, 'Courier credentials saved', result);
});

const getAllCredentials = asyncHandler(async (req: Request, res: Response) => {
  const result = await CourierService.getAllCredentials();
  ApiResponse.sendSuccess(res, 200, 'All courier credentials retrieved', result);
});

const checkAddonLimit = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  const result = await CourierService.checkCourierAddonLimit(tenantId);
  ApiResponse.sendSuccess(res, 200, 'Courier Add-on check passed', result);
});

const forwardOrder = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  const { orderId, providerId } = req.body;
  if (!orderId || !providerId) {
    return ApiResponse.sendError(res, 400, 'Order ID and Provider ID are required');
  }
  const result = await CourierService.forwardOrder(orderId, tenantId, providerId);
  ApiResponse.sendSuccess(res, 200, 'Order forwarded successfully', result);
});

export const CourierController = {
  getMyCourierCharge,
  getStorefrontCourierCharge,
  updateCourierCharge,
  saveCredentials,
  getAllCredentials,
  checkAddonLimit,
  forwardOrder,
};
