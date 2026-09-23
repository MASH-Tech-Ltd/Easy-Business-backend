import { Request, Response } from 'express';
import { TenantService } from './tenant.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { uploadCloudinary } from '../../helpers/cloudinary';

const createTenant = asyncHandler(async (req: Request, res: Response) => {
  const result = await TenantService.createTenant(req.body);
  ApiResponse.sendSuccess(res, 201, 'Tenant and Admin created successfully', result);
});

const getAllTenants = asyncHandler(async (req: Request, res: Response) => {
  const result = await TenantService.getAllTenants(req.query);
  ApiResponse.sendSuccess(res, 200, 'Tenants retrieved successfully', result.data, result.meta);
});

const getMyStore = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await TenantService.getMyStore(tenantId);
  ApiResponse.sendSuccess(res, 200, 'Store retrieved successfully', result);
});

const updateMyStore = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  
  if (req.file) {
    const uploadResult = await uploadCloudinary(req.file.path);
    req.body.logo = uploadResult.secure_url;
  }
  
  if (req.body.checkoutNote !== undefined) {
    req.body['settings.checkoutNote'] = req.body.checkoutNote;
    delete req.body.checkoutNote;
  }
  
  const result = await TenantService.updateMyStore(tenantId, req.body);
  ApiResponse.sendSuccess(res, 200, 'Store updated successfully', result);
});

const addCustomDomain = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { customDomain } = req.body;
  const result = await TenantService.addCustomDomain(tenantId, customDomain);
  
  let message = 'Custom domain added successfully. Please verify DNS.';
  if ((result as any).isRetry) {
    if ((result as any).status === 'active') {
      message = 'Domain verified and active successfully!';
    } else {
      message = 'Refresh successful. Still verifying DNS records...';
    }
  }
  
  ApiResponse.sendSuccess(res, 200, message, result);
});

const getStoreInfoByDomain = asyncHandler(async (req: Request, res: Response) => {
  const { domain } = req.query;
  if (!domain || typeof domain !== 'string') {
    return ApiResponse.sendError(res, 400, 'Domain query parameter is required');
  }
  const result = await TenantService.getStoreInfoByDomain(domain);
  ApiResponse.sendSuccess(res, 200, 'Store info retrieved successfully', result);
});

const updateTenant = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await TenantService.updateTenant(id as string, req.body);
  ApiResponse.sendSuccess(res, 200, 'Tenant updated successfully', result);
});

const getTenantMetrics = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await TenantService.getTenantMetrics(id as string, req.query);
  ApiResponse.sendSuccess(res, 200, 'Tenant metrics retrieved successfully', result);
});

const deleteTenant = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await TenantService.deleteTenant(id as string);
  ApiResponse.sendSuccess(res, 200, 'Tenant deleted successfully', result);
});

export const TenantController = {
  createTenant,
  getAllTenants,
  getMyStore,
  updateMyStore,
  addCustomDomain,
  getStoreInfoByDomain,
  updateTenant,
  getTenantMetrics,
  deleteTenant
};
