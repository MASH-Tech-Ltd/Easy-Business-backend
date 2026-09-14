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

  // Clean up stale cookies
  res.clearCookie('refreshToken');
  res.clearCookie('accessToken');

  res.cookie('_r_sess_tkn', refreshToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  });

  res.cookie('_x_sess_tkn', others.accessToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  });

  ApiResponse.sendSuccess(res, 200, 'User logged in successfully', others);
});

const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await AuthService.forgotPassword(req.body.email);
  ApiResponse.sendSuccess(res, 200, 'Password reset email sent', result);
});

const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await AuthService.resetPassword(req.body.resetToken, req.body.otp, req.body.password);
  ApiResponse.sendSuccess(res, 200, 'Password reset successfully', result);
});

const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies._r_sess_tkn;
  const result = await AuthService.refreshToken(token);

  res.cookie('_r_sess_tkn', result.refreshToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  });

  ApiResponse.sendSuccess(res, 200, 'Token refreshed successfully', {
    accessToken: result.accessToken,
  });
});

const logout = asyncHandler(async (req: Request, res: Response) => {
  // Clean up old stale cookies
  res.clearCookie('refreshToken');
  res.clearCookie('accessToken');
  
  res.clearCookie('_r_sess_tkn', {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  });

  res.clearCookie('_x_sess_tkn', {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  });

  ApiResponse.sendSuccess(res, 200, 'User logged out successfully', null);
});

export const AuthController = {
  register,
  login,
  forgotPassword,
  resetPassword,
  refreshToken,
  logout,
};
