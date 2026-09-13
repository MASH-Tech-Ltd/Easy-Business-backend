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

export const AuthController = {
  register,
  login,
};
