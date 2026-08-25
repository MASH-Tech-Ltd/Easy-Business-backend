import { Request, Response } from 'express';
import { SubscriptionService } from './subscription.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const assignPackage = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.assignPackage(req.body);
  ApiResponse.sendSuccess(res, 201, 'Package assigned to tenant successfully', result);
});

const getTenantSubscription = asyncHandler(async (req: Request, res: Response) => {
  const callerRole = (req as any).user.role;
  const callerTenantId = (req as any).user.tenantId?.toString();
  const requestedTenantId = req.params.tenantId as string;

  // SECURITY FIX: tenant_admin can only view their own subscription — prevent IDOR
  if (callerRole === 'tenant_admin' && callerTenantId !== requestedTenantId) {
    return ApiResponse.sendError(res, 403, 'Forbidden: You can only view your own subscription');
  }

  const result = await SubscriptionService.getTenantSubscription(requestedTenantId);
  ApiResponse.sendSuccess(res, 200, 'Tenant subscription retrieved successfully', result);
});

const getMySubscription = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await SubscriptionService.getTenantSubscription(tenantId);
  ApiResponse.sendSuccess(res, 200, 'My subscription retrieved successfully', result);
});

const requestPackage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await SubscriptionService.requestPackage(tenantId, req.body.packageId);
  ApiResponse.sendSuccess(res, 201, 'Package requested successfully', result);
});

const approveSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.approveSubscription(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Subscription approved successfully', result);
});

const rejectSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.rejectSubscription(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Subscription rejected successfully', result);
});

const getAllSubscriptions = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.getAllSubscriptions();
  ApiResponse.sendSuccess(res, 200, 'All subscriptions retrieved successfully', result);
});

const updateSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.updateSubscription(req.params.id as string, req.body);
  ApiResponse.sendSuccess(res, 200, 'Subscription updated successfully', result);
});

const deleteSubscription = asyncHandler(async (req: Request, res: Response) => {
  await SubscriptionService.deleteSubscription(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Subscription deleted successfully', null);
});

export const SubscriptionController = {
  assignPackage,
  getTenantSubscription,
  getMySubscription,
  requestPackage,
  approveSubscription,
  rejectSubscription,
  getAllSubscriptions,
  updateSubscription,
  deleteSubscription,
};
