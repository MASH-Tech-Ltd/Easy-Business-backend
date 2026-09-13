import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await AuthService.register(req.body);
  ApiResponse.sendSuccess(res, 201, 'User registered successfully', result);
});

const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await AuthService.login(req.body);
  const { refreshToken, ...others } = result;

  res.cookie('refreshToken', refreshToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  });

  ApiResponse.sendSuccess(res, 200, 'User logged in successfully', others);
});

const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await AuthService.forgotPassword(req.body.email);
  ApiResponse.sendSuccess(res, 200, 'Password reset email sent', result);
});

const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await AuthService.resetPassword(req.body.otp, req.body.password);
  ApiResponse.sendSuccess(res, 200, 'Password reset successfully', result);
});

const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies.refreshToken;
  const result = await AuthService.refreshToken(token);

  res.cookie('refreshToken', result.refreshToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  });

  ApiResponse.sendSuccess(res, 200, 'Token refreshed successfully', {
    accessToken: result.accessToken,
  });
});

export const AuthController = {
  register,
  login,
  forgotPassword,
  resetPassword,
  refreshToken,
};
