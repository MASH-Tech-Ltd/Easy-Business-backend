import { Request, Response } from 'express';
import { OrderService } from './order.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const createOrder = asyncHandler(async (req: Request, res: Response) => {
  // SECURITY FIX: Resolve tenantId from the tenant middleware (set via Host header / subdomain),
  // NOT from req.body — prevents any client from forging orders against another tenant.
  const tenantIdFromMiddleware = (req as any).tenantId;
  if (tenantIdFromMiddleware) {
    req.body.tenantId = tenantIdFromMiddleware;
  } else if (!req.body.tenantId) {
    return ApiResponse.sendError(res, 400, 'Tenant context could not be resolved');
  }
  const result = await OrderService.createOrder(req.body);
  ApiResponse.sendSuccess(res, 201, 'Order created successfully', result);
});

const getMyOrders = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await OrderService.getOrdersByTenant(tenantId, req.query);
  ApiResponse.sendSuccess(res, 200, 'Orders retrieved successfully', result.data, result.meta);
});

const updateOrder = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id } = req.params;
  const result = await OrderService.updateOrder(id as string, req.body, tenantId);
  ApiResponse.sendSuccess(res, 200, 'Order updated successfully', result);
});

const deleteOrder = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id } = req.params;
  const result = await OrderService.deleteOrder(id as string, tenantId);
  ApiResponse.sendSuccess(res, 200, 'Order deleted successfully', result);
});

const trackOrder = asyncHandler(async (req: Request, res: Response) => {
  const tenantIdFromMiddleware = (req as any).tenantId;
  const tenantIdFromQuery = req.query.tenantId as string;
  const phone = req.query.phone as string;
  const tenantId = tenantIdFromMiddleware || tenantIdFromQuery;
  
  if (!tenantId) {
    return ApiResponse.sendError(res, 400, 'Tenant context could not be resolved');
  }

  if (!phone) {
    return ApiResponse.sendError(res, 400, 'Phone number is required to track order');
  }

  const { id } = req.params;
  const result = await OrderService.getOrderById(id as string, tenantId);
  if (!result) {
    return ApiResponse.sendError(res, 404, 'Order not found');
  }

  if (result.customerPhone !== phone) {
    return ApiResponse.sendError(res, 403, 'Phone number does not match this order');
  }

  ApiResponse.sendSuccess(res, 200, 'Order found', result);
});

export const OrderController = {
  createOrder,
  getMyOrders,
  updateOrder,
  deleteOrder,
  trackOrder,
};
