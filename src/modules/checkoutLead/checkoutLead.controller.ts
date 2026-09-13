import { Request, Response } from 'express';
import { CheckoutLeadService } from './checkoutLead.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const trackLead = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId; // From tenantMiddleware
  
  if (!tenantId) {
    return ApiResponse.sendError(res, 400, 'Tenant ID not found in request context');
  }

  // Only track if there's at least a phone or email
  if (!req.body.phone && !req.body.email) {
    return ApiResponse.sendSuccess(res, 200, 'Ignored: No contact info provided', null);
  }

  const result = await CheckoutLeadService.trackLead(tenantId, req.body);
  ApiResponse.sendSuccess(res, 200, 'Lead tracked successfully', result);
});

const getMerchantLeads = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId; // From authMiddleware
  
  const result = await CheckoutLeadService.getMerchantLeads(tenantId, req.query);
  ApiResponse.sendSuccess(res, 200, 'Leads retrieved successfully', result);
});

const getLeadStats = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId; // From authMiddleware
  
  const result = await CheckoutLeadService.getLeadStats(tenantId);
  ApiResponse.sendSuccess(res, 200, 'Lead stats retrieved successfully', result);
});

export const CheckoutLeadController = {
  trackLead,
  getMerchantLeads,
  getLeadStats,
};
