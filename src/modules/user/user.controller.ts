import { Request, Response } from "express";
import { UserService } from "./user.service";
import ApiResponse from "../../utils/apiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { uploadCloudinary } from "../../helpers/cloudinary";

const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user._id;

  if (req.file) {
    const uploadResult = await uploadCloudinary(req.file.path);
    req.body.avatar = {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url
    };
  }

  const result = await UserService.updateProfile(userId, req.body);
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
