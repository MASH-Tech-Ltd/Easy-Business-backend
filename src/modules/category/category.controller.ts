import { Request, Response } from 'express';
import { CategoryService } from './category.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { uploadCloudinary } from "../../helpers/cloudinary";

const createCategory = asyncHandler(async (req: Request, res: Response) => {
  req.body.tenantId = (req as any).user.tenantId;

  if (req.file) {
    const uploadResult = await uploadCloudinary(req.file.path);
    req.body.image = {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url
    };
  }

  const result = await CategoryService.createCategory(req.body);
  ApiResponse.sendSuccess(res, 201, 'Category created successfully', result);
});

const getCategoriesByTenant = asyncHandler(async (req: Request, res: Response) => {
  const result = await CategoryService.getCategoriesByTenant(req.params.tenantId as string, req.query);
  ApiResponse.sendSuccess(res, 200, 'Categories retrieved successfully', result.data, result.meta);
});

const getAllCategories = asyncHandler(async (req: Request, res: Response) => {
  const result = await CategoryService.getAllCategories();
  ApiResponse.sendSuccess(res, 200, 'All Categories retrieved successfully', result);
});

const getMyCategories = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await CategoryService.getCategoriesByTenant(tenantId, req.query);
  ApiResponse.sendSuccess(res, 200, 'Categories retrieved successfully', result.data, result.meta);
});

const getSingleCategory = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await CategoryService.getSingleCategory(req.params.id as string, tenantId);
  if (!result) {
    return ApiResponse.sendError(res, 404, 'Category not found or unauthorized');
  }
  ApiResponse.sendSuccess(res, 200, 'Category retrieved successfully', result);
});

const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  
  if (req.file) {
    const uploadResult = await uploadCloudinary(req.file.path);
    req.body.image = {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url
    };
  }

  const result = await CategoryService.updateCategory(req.params.id as string, tenantId, req.body);
  if (!result) {
    return ApiResponse.sendError(res, 404, 'Category not found or unauthorized');
  }
  ApiResponse.sendSuccess(res, 200, 'Category updated successfully', result);
});

const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await CategoryService.deleteCategory(req.params.id as string, tenantId);
  if (!result) {
    return ApiResponse.sendError(res, 404, 'Category not found or unauthorized');
  }
  ApiResponse.sendSuccess(res, 200, 'Category deleted successfully', result);
});

export const CategoryController = {
  createCategory,
  getCategoriesByTenant,
  getAllCategories,
  getMyCategories,
  getSingleCategory,
  updateCategory,
  deleteCategory,
};
