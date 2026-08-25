import { Request, Response } from 'express';
import { PackageService } from './package.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const createPackage = asyncHandler(async (req: Request, res: Response) => {
  const result = await PackageService.createPackage(req.body);
  ApiResponse.sendSuccess(res, 201, 'Package created successfully', result);
});

const getAllPackages = asyncHandler(async (req: Request, res: Response) => {
  const page = req.query.page as string | undefined;
  const limit = req.query.limit as string | undefined;
  const { data, meta } = await PackageService.getAllPackages(page, limit);
  ApiResponse.sendSuccess(res, 200, 'Packages retrieved successfully', data, meta);
});

const updatePackage = asyncHandler(async (req: Request, res: Response) => {
  const result = await PackageService.updatePackage(req.params.id as string, req.body);
  ApiResponse.sendSuccess(res, 200, 'Package updated successfully', result);
});

const deletePackage = asyncHandler(async (req: Request, res: Response) => {
  const result = await PackageService.deletePackage(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Package deleted successfully', result);
});

export const PackageController = {
  createPackage,
  getAllPackages,
  updatePackage,
  deletePackage
};
