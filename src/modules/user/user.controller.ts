import { Request, Response } from "express";
import { UserService } from "./user.service";
import ApiResponse from "../../utils/apiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { uploadCloudinary, deleteCloudinary } from "../../helpers/cloudinary";
import CustomError from "../../helpers/CustomError";

const isValidBDPhone = (phone?: string): boolean => {
  if (!phone || !phone.trim()) return true;
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  return /^(?:\+?88|88)?01[3-9]\d{8}$/.test(cleanPhone);
};

const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user._id;
  let oldAvatarPublicId: string | null = null;

  // Validate personal phone
  if (req.body.phone && !isValidBDPhone(req.body.phone)) {
    throw new CustomError(400, "Invalid Bangladeshi phone number for Personal Phone. Must be a valid 11-digit BD number (e.g. 01XXXXXXXXXX).");
  }

  // Validate support phone in details
  if (req.body.details) {
    try {
      const parsedDetails = typeof req.body.details === 'string' && req.body.details.startsWith('{') 
        ? JSON.parse(req.body.details) 
        : req.body.details;
      if (parsedDetails?.supportPhone && !isValidBDPhone(parsedDetails.supportPhone)) {
        throw new CustomError(400, "Invalid Bangladeshi phone number for Support Phone. Must be a valid 11-digit BD number (e.g. 01XXXXXXXXXX).");
      }
    } catch (e: any) {
      if (e instanceof CustomError) throw e;
    }
  }

  if (req.file) {
    const oldUser = await UserService.getUserById(userId);
    if (oldUser && oldUser.avatar && oldUser.avatar.public_id) {
      oldAvatarPublicId = oldUser.avatar.public_id;
    }
    
    const uploadResult = await uploadCloudinary(req.file.path);
    req.body.avatar = {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url
    };
  }

  const result = await UserService.updateProfile(userId, req.body);

  // Delete old avatar ONLY AFTER successful database update
  if (oldAvatarPublicId && req.file) {
    deleteCloudinary(oldAvatarPublicId, 'image').catch(err => console.error("Failed to delete old avatar from Cloudinary:", err));
  }

  ApiResponse.sendSuccess(res, 200, "Profile updated successfully", result);
});

const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await UserService.getAllUsers(req.query);
  ApiResponse.sendSuccess(res, 200, "Users retrieved successfully", result);
});

const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const result = await UserService.getUserById(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, "User retrieved successfully", result);
});

const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await UserService.updateUser(req.params.id as string, req.body);
  ApiResponse.sendSuccess(res, 200, "User updated successfully", result);
});

const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await UserService.deleteUser(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, "User deleted successfully", result);
});

export const UserController = {
  updateProfile,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
};
