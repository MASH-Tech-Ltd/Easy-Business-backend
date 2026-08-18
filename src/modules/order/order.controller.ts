import { Request, Response } from 'express';
import { OrderService } from './order.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const createOrder = asyncHandler(async (req: Request, res: Response) => {
  // Storefront orders are public, so they pass the tenantId in the body
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

export const OrderController = {
  createOrder,
  getMyOrders,
  updateOrder,
  deleteOrder,
};
