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

  const isSuperAdmin = others.user.role === 'super_admin';
  const rCookieName = isSuperAdmin ? '_super_r_tkn' : '_merchant_r_tkn';
  const xCookieName = isSuperAdmin ? '_super_x_tkn' : '_merchant_x_tkn';

  res.cookie(rCookieName, refreshToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  });

  res.cookie(xCookieName, others.accessToken, {
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
  const token = req.cookies._super_r_tkn || req.cookies._merchant_r_tkn || req.cookies._r_sess_tkn;
  const result = await AuthService.refreshToken(token);

  const isSuperAdmin = result.user.role === 'super_admin';
  const rCookieName = isSuperAdmin ? '_super_r_tkn' : '_merchant_r_tkn';

  res.cookie(rCookieName, result.refreshToken, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  });

  ApiResponse.sendSuccess(res, 200, 'Token refreshed successfully', {
    accessToken: result.accessToken,
  });
});

const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies._super_r_tkn || req.cookies._merchant_r_tkn || req.cookies._r_sess_tkn || req.cookies.refreshToken;
  if (token) {
    await AuthService.logout(token);
  }

  // Clean up old stale cookies and all possible role cookies
  const cookiesToClear = [
    'refreshToken', 'accessToken', '_r_sess_tkn', '_x_sess_tkn',
    '_super_r_tkn', '_merchant_r_tkn', '_super_x_tkn', '_merchant_x_tkn'
  ];

  cookiesToClear.forEach(cookie => {
    res.clearCookie(cookie, {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    });
  });

  ApiResponse.sendSuccess(res, 200, 'User logged out successfully', null);
});

const requestChangePassword = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?._id as string;
  const result = await AuthService.requestChangePassword(userId, req.body.oldPassword);
  ApiResponse.sendSuccess(res, 200, 'OTP sent to email', result);
});

const verifyChangePassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await AuthService.verifyChangePassword(req.body.resetToken, req.body.otp, req.body.newPassword);
  ApiResponse.sendSuccess(res, 200, 'Password changed successfully', result);
});

export const AuthController = {
  register,
  login,
  forgotPassword,
  resetPassword,
  refreshToken,
  logout,
  requestChangePassword,
  verifyChangePassword,
};
