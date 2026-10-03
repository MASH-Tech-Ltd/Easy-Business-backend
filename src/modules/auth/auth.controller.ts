import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { VisitorLog } from '../system/security.model';
import { getClientIp } from '../../utils/ipHelper';
import config from '../../config';

const isProduction = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  path: '/',
  secure: isProduction,
  httpOnly: true,
  sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days persistent cookie
  ...(isProduction && config.app.baseDomain ? { domain: `.${config.app.baseDomain}` } : {}),
};

const ALL_COOKIE_NAMES = [
  'refreshToken',
  'accessToken',
  '_r_sess_tkn',
  '_x_sess_tkn',
  '_super_r_tkn',
  '_merchant_r_tkn',
  '_super_x_tkn',
  '_merchant_x_tkn',
];

const clearAllAuthCookies = (res: Response, role?: string) => {
  if (role === 'super_admin') {
    res.clearCookie('_super_r_tkn', COOKIE_OPTIONS);
    res.clearCookie('_super_x_tkn', COOKIE_OPTIONS);
    res.clearCookie('_super_r_tkn', { path: '/' });
    res.clearCookie('_super_x_tkn', { path: '/' });
  } else if (role === 'tenant_admin' || role === 'user') {
    res.clearCookie('_merchant_r_tkn', COOKIE_OPTIONS);
    res.clearCookie('_merchant_x_tkn', COOKIE_OPTIONS);
    res.clearCookie('refreshToken', COOKIE_OPTIONS);
    res.clearCookie('accessToken', COOKIE_OPTIONS);
    res.clearCookie('_merchant_r_tkn', { path: '/' });
    res.clearCookie('_merchant_x_tkn', { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });
    res.clearCookie('accessToken', { path: '/' });
  } else {
    ALL_COOKIE_NAMES.forEach((cookieName) => {
      res.clearCookie(cookieName, COOKIE_OPTIONS);
      res.clearCookie(cookieName, { path: '/' });
      res.clearCookie(cookieName);
    });
  }
};

const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await AuthService.register(req.body);
  ApiResponse.sendSuccess(res, 201, 'User registered successfully', result);
});

const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await AuthService.login(req.body);

  if (result.requires2FA) {
    return ApiResponse.sendSuccess(res, 200, '2FA code required', {
      requires2FA: true,
      twoFactorToken: result.twoFactorToken,
      user: result.user,
    });
  }

  const { refreshToken, ...others } = result;

  const isSuperAdmin = others.user.role === 'super_admin';
  const rCookieName = isSuperAdmin ? '_super_r_tkn' : '_merchant_r_tkn';
  const xCookieName = isSuperAdmin ? '_super_x_tkn' : '_merchant_x_tkn';

  // Clean up only previous cookies for this specific role
  clearAllAuthCookies(res, others.user.role);

  res.cookie(rCookieName, refreshToken, COOKIE_OPTIONS);
  res.cookie(xCookieName, others.accessToken, COOKIE_OPTIONS);

  // Automatically record Visitor Log entry
  try {
    const roleName = isSuperAdmin ? 'Super Admin' : (others.user.role === 'tenant_admin' ? 'Merchant' : 'Customer');
    await VisitorLog.create({
      role: roleName,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || 'Unknown',
      storeName: (others.user as any).storeName || others.user.name || 'Platform',
      ownerName: others.user.name || others.user.email,
    });
  } catch (err) {
    console.error('Failed to record visitor log:', err);
  }

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
  const token = req.cookies._super_r_tkn || req.cookies._merchant_r_tkn || req.cookies._r_sess_tkn || req.cookies.refreshToken;
  const result = await AuthService.refreshToken(token);

  const isSuperAdmin = result.user.role === 'super_admin';
  const rCookieName = isSuperAdmin ? '_super_r_tkn' : '_merchant_r_tkn';
  const xCookieName = isSuperAdmin ? '_super_x_tkn' : '_merchant_x_tkn';

  // Set BOTH regenerated refresh token AND new access token in HttpOnly cookies
  res.cookie(rCookieName, result.refreshToken, COOKIE_OPTIONS);
  res.cookie(xCookieName, result.accessToken, COOKIE_OPTIONS);

  ApiResponse.sendSuccess(res, 200, 'Token refreshed successfully', {
    accessToken: result.accessToken,
  });
});

const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies._super_r_tkn || req.cookies._merchant_r_tkn || req.cookies._r_sess_tkn || req.cookies.refreshToken;
  if (token) {
    await AuthService.logout(token);
  }

  // Determine which role is logging out and only clear that role's cookies
  const isSuper = Boolean(req.cookies._super_r_tkn || req.cookies._super_x_tkn);
  clearAllAuthCookies(res, isSuper ? 'super_admin' : 'tenant_admin');

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

const changePasswordDirect = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?._id as string;
  const { oldPassword, newPassword } = req.body;
  const result = await AuthService.changePasswordDirect(userId, oldPassword, newPassword);
  ApiResponse.sendSuccess(res, 200, 'Password updated successfully', result);
});

const setup2FA = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?._id as string;
  const result = await AuthService.setup2FA(userId);
  ApiResponse.sendSuccess(res, 200, '2FA setup initiated', result);
});

const verifyEnable2FA = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?._id as string;
  const result = await AuthService.verifyEnable2FA(userId, req.body.code);
  ApiResponse.sendSuccess(res, 200, '2FA enabled successfully', result);
});

const disable2FA = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?._id as string;
  const result = await AuthService.disable2FA(userId, req.body.code);
  ApiResponse.sendSuccess(res, 200, '2FA disabled successfully', result);
});

const get2FAStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?._id as string;
  const result = await AuthService.get2FAStatus(userId);
  ApiResponse.sendSuccess(res, 200, '2FA status fetched', result);
});

const verify2FALogin = asyncHandler(async (req: Request, res: Response) => {
  const { twoFactorToken, code } = req.body;
  const result = await AuthService.verify2FALogin(twoFactorToken, code);
  const { refreshToken, ...others } = result;
  const isSuperAdmin = others.user.role === 'super_admin';
  const rCookieName = isSuperAdmin ? '_super_r_tkn' : '_merchant_r_tkn';
  const xCookieName = isSuperAdmin ? '_super_x_tkn' : '_merchant_x_tkn';

  // Clean up only previous cookies for this specific role
  clearAllAuthCookies(res, others.user.role);

  res.cookie(rCookieName, refreshToken, COOKIE_OPTIONS);
  res.cookie(xCookieName, others.accessToken, COOKIE_OPTIONS);

  // Automatically record Visitor Log entry
  try {
    const roleName = isSuperAdmin ? 'Super Admin' : (others.user.role === 'tenant_admin' ? 'Merchant' : 'Customer');
    await VisitorLog.create({
      role: roleName,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || 'Unknown',
      storeName: (others.user as any).storeName || others.user.name || 'Platform',
      ownerName: others.user.name || others.user.email,
    });
  } catch (err) {
    console.error('Failed to record visitor log on 2FA login:', err);
  }

  ApiResponse.sendSuccess(res, 200, '2FA login verified successfully', others);
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
  changePasswordDirect,
  setup2FA,
  verifyEnable2FA,
  disable2FA,
  get2FAStatus,
  verify2FALogin,
};
