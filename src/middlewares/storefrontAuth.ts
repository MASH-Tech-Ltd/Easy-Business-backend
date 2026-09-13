import { Request, Response, NextFunction } from 'express';
import CustomError from '../helpers/CustomError';

export const storefrontAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-storefront-api-key'];
  const validApiKey = process.env.STOREFRONT_API_KEY;

  if (!validApiKey) {
    console.error('STOREFRONT_API_KEY is not configured in environment variables');
    return next(new CustomError(500, 'Server configuration error'));
  }

  if (!apiKey || apiKey !== validApiKey) {
    return next(new CustomError(401, 'Unauthorized Access: Invalid or missing API key'));
  }

  next();
};
