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

export const CourierController = {
  getMyCourierCharge,
  getStorefrontCourierCharge,
  updateCourierCharge,
  saveCredentials,
  getAllCredentials,
};
