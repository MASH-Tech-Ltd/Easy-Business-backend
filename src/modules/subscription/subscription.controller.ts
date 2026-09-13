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
  const includeExpired = req.query.includeExpired === 'true';

  const result = await SubscriptionService.getTenantSubscription(tenantId);

  if (!result && includeExpired) {
    // No active sub — return the last expired/cancelled one for display purposes
    const lastSub = await (await import('./subscription.model')).Subscription.findOne(
      { tenantId, status: { $in: ['expired', 'cancelled'] } },
      null,
      { sort: { endDate: -1 } }
    ).populate('packageId');

    if (lastSub) {
      return ApiResponse.sendSuccess(res, 200, 'My subscription retrieved successfully', {
        ...lastSub.toObject(),
        status: 'expired', // normalise to expired regardless of cancelled
      });
    }
  }

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
  const result = await SubscriptionService.getAllSubscriptions(req.query);
  ApiResponse.sendSuccess(res, 200, 'All subscriptions retrieved successfully', result.data, result.meta);
});

const updateSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.updateSubscription(req.params.id as string, req.body);
  ApiResponse.sendSuccess(res, 200, 'Subscription updated successfully', result);
});

const deleteSubscription = asyncHandler(async (req: Request, res: Response) => {
  await SubscriptionService.deleteSubscription(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Subscription deleted successfully', null);
});

const purchaseAddon = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await SubscriptionService.purchaseAddon(tenantId, req.body);
  ApiResponse.sendSuccess(res, 200, 'Addon purchased successfully', result);
});

const getAllAddonRequests = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.getAllAddonRequests(req.query);
  ApiResponse.sendSuccess(res, 200, 'All addon requests retrieved successfully', result);
});

const approveAddonRequest = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const result = await SubscriptionService.approveAddonRequest(subscriptionId as string, addonId as string);
  ApiResponse.sendSuccess(res, 200, 'Addon request approved successfully', result);
});

const rejectAddonRequest = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const result = await SubscriptionService.rejectAddonRequest(subscriptionId as string, addonId as string);
  ApiResponse.sendSuccess(res, 200, 'Addon request rejected successfully', result);
});

const removeAddon = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const result = await SubscriptionService.removeAddon(subscriptionId as string, addonId as string);
  ApiResponse.sendSuccess(res, 200, 'Addon removed successfully', result);
});

export const SubscriptionController = {
  assignPackage,
  getTenantSubscription,
  getMySubscription,
  requestPackage,
  approveSubscription,
  rejectSubscription,
  updateSubscription,
  deleteSubscription,
  getAllSubscriptions,
  purchaseAddon,
  getAllAddonRequests,
  approveAddonRequest,
  rejectAddonRequest,
  removeAddon
};
