import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';

export const authMiddleware = (...requiredRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization;
      
      if (!token) {
        return res.status(401).json({ success: false, message: 'You are not authorized' });
      }

      const verifiedUser = jwt.verify(token.replace('Bearer ', ''), config.jwt_secret) as any;

      if (requiredRoles.length && !requiredRoles.includes(verifiedUser.role)) {
        return res.status(403).json({ success: false, message: 'Forbidden access' });
      }

      req.user = verifiedUser;
      next();
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };
};
