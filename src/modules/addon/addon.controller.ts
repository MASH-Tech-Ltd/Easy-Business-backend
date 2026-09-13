import { Request, Response } from 'express';
import { AddonService } from './addon.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const createAddon = asyncHandler(async (req: Request, res: Response) => {
  const result = await AddonService.createAddon(req.body);
  ApiResponse.sendSuccess(res, 201, 'Addon created successfully', result);
});

const getAllAddons = asyncHandler(async (req: Request, res: Response) => {
  const result = await AddonService.getAllAddons();
  ApiResponse.sendSuccess(res, 200, 'Addons retrieved successfully', result);
});

const getAddonById = asyncHandler(async (req: Request, res: Response) => {
  const result = await AddonService.getAddonById(req.params.id as string );
  ApiResponse.sendSuccess(res, 200, 'Addon retrieved successfully', result);
});

const updateAddon = asyncHandler(async (req: Request, res: Response) => {
  const result = await AddonService.updateAddon(req.params.id as string, req.body);
  ApiResponse.sendSuccess(res, 200, 'Addon updated successfully', result);
});

const deleteAddon = asyncHandler(async (req: Request, res: Response) => {
  await AddonService.deleteAddon(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Addon deleted successfully', null);
});

const predefinedAddons = [
  {
    name: "Abandoned Checkout",
    slug: "abandoned_checkout",
    description: "Capture and recover abandoned checkout leads to increase sales.",
    price: 9.99,
    billingCycle: "monthly",
    defaultLimit: 100,
    isActive: true,
  },
  {
    name: "Fraud Check",
    slug: "fraud_check",
    description: "Advanced fraud detection for your orders.",
    price: 19.99,
    billingCycle: "monthly",
    defaultLimit: 50,
    isActive: true,
  },
  {
    name: "SMS Notifications",
    slug: "sms_notifications",
    description: "Send automated SMS updates to your customers.",
    price: 14.99,
    billingCycle: "monthly",
    defaultLimit: 500,
    isActive: true,
  },
  {
    name: "Email Marketing",
    slug: "mail_marketing",
    description: "Powerful email marketing tools to boost retention.",
    price: 29.99,
    billingCycle: "monthly",
    defaultLimit: 10000,
    isActive: true,
  },
  {
    name: "Advanced Analytics",
    slug: "analytic_reports",
    description: "Deep dive into your store's performance with custom reports.",
    price: 49.99,
    billingCycle: "yearly",
    defaultLimit: 100,
    isActive: true,
  },
  {
    name: "Courier Automation",
    slug: "courier_automation",
    description: "Automate your shipping and fulfillment processes seamlessly.",
    price: 39.99,
    billingCycle: "monthly",
    defaultLimit: 1000,
    isActive: true,
  }
];

const getPredefinedAddons = asyncHandler(async (req: Request, res: Response) => {
  ApiResponse.sendSuccess(res, 200, 'Predefined addons retrieved', predefinedAddons);
});

export const AddonController = {
  createAddon,
  getAllAddons,
  getAddonById,
  updateAddon,
  deleteAddon,
  getPredefinedAddons,
};
