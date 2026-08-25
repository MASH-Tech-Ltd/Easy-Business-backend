import { Request, Response } from "express";
import { ProductService } from "./product.service";
import ApiResponse from "../../utils/apiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { uploadCloudinary } from "../../helpers/cloudinary";
import { SubscriptionService } from "../subscription/subscription.service";
import CustomError from "../../helpers/CustomError";
import { Product } from "./product.model";
import { Subscription } from "../subscription/subscription.model";

const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  req.body.tenantId = tenantId;

  const activeSub = await SubscriptionService.getTenantSubscription(tenantId);
  if (!activeSub || activeSub.status !== 'active') {
    throw new CustomError(403, 'You do not have an active subscription. Please upgrade your plan to add products.');
  }

  if (req.body.features && typeof req.body.features === "string") {
    try {
      req.body.features = JSON.parse(req.body.features);
    } catch (e) {
      req.body.features = [];
    }
  }

  if (req.body.videos && typeof req.body.videos === "string") {
    try {
      req.body.videos = JSON.parse(req.body.videos);
    } catch (e) {
      req.body.videos = [];
    }
  }

  if (req.body.isAuthentic !== undefined) {
    req.body.isAuthentic = req.body.isAuthentic === "true";
  }

  if (req.body.dimensions && typeof req.body.dimensions === "string") {
    try {
      req.body.dimensions = JSON.parse(req.body.dimensions);
    } catch (e) {
      delete req.body.dimensions;
    }
  }

  if (req.body.specifications && typeof req.body.specifications === "string") {
    try {
      req.body.specifications = JSON.parse(req.body.specifications);
    } catch (e) {
      req.body.specifications = [];
    }
  }

  req.body.images = [];
  if (req.files && Array.isArray(req.files)) {
    for (const file of req.files) {
      const uploadResult = await uploadCloudinary(file.path);
      req.body.images.push({
        public_id: uploadResult.public_id,
        secure_url: uploadResult.secure_url,
      });
    }
  }

  const result = await ProductService.createProduct(req.body);
  ApiResponse.sendSuccess(res, 201, "Product created successfully", result);
});

// SECURITY FIX: getAllProducts is now super_admin only — guarded at the route level
const getAllProducts = asyncHandler(async (req: Request, res: Response) => {
  const result = await ProductService.getAllProducts();
  ApiResponse.sendSuccess(res, 200, "Products retrieved successfully", result);
});

const getProductsByTenant = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await ProductService.getProductsByTenant(
      req.params.tenantId as string,
      req.query
    );
    ApiResponse.sendSuccess(
      res,
      200,
      "Products retrieved successfully",
      result.data,
      result.meta
    );
  },
);

const getMyProducts = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await ProductService.getMyProducts(tenantId, req.query);
  ApiResponse.sendSuccess(
    res,
    200,
    "Products retrieved successfully",
    result.data,
    result.meta,
  );
});

const getSingleProduct = asyncHandler(async (req: Request, res: Response) => {
  const result = await ProductService.getSingleProduct(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, "Product retrieved successfully", result);
});

const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  // SECURITY FIX (IDOR): Get tenantId from JWT, not from request body
  const tenantId = (req as any).user.tenantId;

  if (req.body.features && typeof req.body.features === "string") {
    try {
      req.body.features = JSON.parse(req.body.features);
    } catch (e) {
      delete req.body.features;
    }
  }

  if (req.body.videos && typeof req.body.videos === "string") {
    try {
      req.body.videos = JSON.parse(req.body.videos);
    } catch (e) {
      delete req.body.videos;
    }
  }

  if (req.body.dimensions && typeof req.body.dimensions === "string") {
    try {
      req.body.dimensions = JSON.parse(req.body.dimensions);
    } catch (e) {
      delete req.body.dimensions;
    }
  }

  if (req.body.specifications && typeof req.body.specifications === "string") {
    try {
      req.body.specifications = JSON.parse(req.body.specifications);
    } catch (e) {
      delete req.body.specifications;
    }
  }

  if (req.body.isAuthentic !== undefined) {
    req.body.isAuthentic = req.body.isAuthentic === "true";
  }

  let existingImages = [];
  if (req.body.existingImages) {
    try {
      existingImages = JSON.parse(req.body.existingImages);
    } catch (e) {
      existingImages = [];
    }
  }

  let newImages = [];
  if (req.files && Array.isArray(req.files) && req.files.length > 0) {
    for (const file of req.files) {
      const uploadResult = await uploadCloudinary(file.path);
      newImages.push({
        public_id: uploadResult.public_id,
        secure_url: uploadResult.secure_url,
      });
    }
  }

  if (req.body.existingImages !== undefined || newImages.length > 0) {
    req.body.images = [...existingImages, ...newImages];
  }

  // SECURITY FIX (IDOR): Pass tenantId so service scopes the query to caller's tenant
  const result = await ProductService.updateProduct(
    req.params.id as string,
    tenantId,
    req.body,
  );
  ApiResponse.sendSuccess(res, 200, "Product updated successfully", result);
});

const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  // SECURITY FIX (IDOR): Scope delete to caller's tenantId from JWT
  const tenantId = (req as any).user.tenantId;
  const result = await ProductService.deleteProduct(req.params.id as string, tenantId);
  ApiResponse.sendSuccess(res, 200, "Product deleted successfully", result);
});

const checkProductLimit = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('packageId');
  if (subscription && subscription.packageId) {
    const productLimit = (subscription.packageId as any).productLimit;
    const currentCount = await Product.countDocuments({ tenantId });
    if (currentCount >= productLimit) {
      throw new CustomError(403, "PRODUCT_LIMIT_REACHED");
    }
  }
  ApiResponse.sendSuccess(res, 200, "Limit check passed", { allowed: true });
});

export const ProductController = {
  createProduct,
  checkProductLimit,
  getAllProducts,
  getMyProducts,
  getProductsByTenant,
  getSingleProduct,
  updateProduct,
  deleteProduct,
};
