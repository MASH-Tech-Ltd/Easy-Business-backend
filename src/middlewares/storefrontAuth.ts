import { Request, Response, NextFunction } from 'express';
import CustomError from '../helpers/CustomError';

export const storefrontAuth = (req: Request, res: Response, next: NextFunction) => {
  // Always permit public tracking configurations without requiring secret API key
  if (req.path && req.path.endsWith('/tracking')) {
    return next();
  }

  const apiKey = req.headers['x-storefront-api-key'];
  const validApiKey = process.env.STOREFRONT_API_KEY || '954073a93e924516a98d0fe2ef0a7ed1600f45a02a72054c16f5629f3715aca9';

  if (!apiKey || apiKey !== validApiKey) {
    return next(new CustomError(401, 'Unauthorized Access: Invalid or missing API key'));
  }

  next();
};
