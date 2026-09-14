import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import { roleBasedRateLimiter } from './rateLimiter';

export const authMiddleware = (...requiredRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let token = req.headers.authorization;
      
      if (!token && req.cookies && req.cookies._x_sess_tkn) {
        token = `Bearer ${req.cookies._x_sess_tkn}`;
      }
      
      if (!token) {
        return res.status(401).json({ success: false, message: 'You are not authorized' });
      }

      const verifiedUser = jwt.verify(token.replace('Bearer ', ''), config.jwt.accessSecret) as any;

      if (requiredRoles.length && !requiredRoles.includes(verifiedUser.role)) {
        return res.status(403).json({ success: false, message: 'Forbidden access' });
      }

      req.user = verifiedUser;
      
      // Apply role-based rate limiting automatically to all protected routes
      return roleBasedRateLimiter(req, res, next);
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };
};
