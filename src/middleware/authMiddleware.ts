import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import { roleBasedRateLimiter } from './rateLimiter';
import { Tenant } from '../modules/tenant/tenant.model';
import { User } from '../modules/auth/auth.model';

export const authMiddleware = (...requiredRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let token = req.headers.authorization;
      
      if (!token && req.cookies) {
        // Fallback to legacy cookie if it exists
        if (req.cookies._x_sess_tkn) {
          token = `Bearer ${req.cookies._x_sess_tkn}`;
        }
        
        // If checking for super_admin, prioritize the super cookie
        if (requiredRoles.includes('super_admin') && req.cookies._super_x_tkn) {
          token = `Bearer ${req.cookies._super_x_tkn}`;
        } 
        // Otherwise use the merchant cookie
        else if (req.cookies._merchant_x_tkn) {
          token = `Bearer ${req.cookies._merchant_x_tkn}`;
        }
        // If they just didn't specify super_admin but have super admin cookie (e.g. general auth route)
        else if (req.cookies._super_x_tkn) {
          token = `Bearer ${req.cookies._super_x_tkn}`;
        }
        else if (req.cookies.accessToken) {
          token = `Bearer ${req.cookies.accessToken}`;
        }
      }
      
      if (!token) {
        return res.status(401).json({ success: false, message: 'You are not authorized' });
      }

      const verifiedUser = jwt.verify(token.replace('Bearer ', ''), config.jwt.accessSecret) as any;

      if (requiredRoles.length && !requiredRoles.includes(verifiedUser.role)) {
        return res.status(403).json({ success: false, message: 'Forbidden access' });
      }

      // Enforce merchant store status (see tenant status policy)
      if (verifiedUser.role === 'tenant_admin') {
        const [tenant, userExists] = await Promise.all([
          Tenant.findOne({
            $or: [
              ...(verifiedUser.tenantId ? [{ _id: verifiedUser.tenantId }] : []),
              { ownerId: verifiedUser._id },
            ],
          }).select('status').lean(),
          User.exists({ _id: verifiedUser._id }),
        ]);

        // If merchant tenant or merchant user was deleted, reject immediately
        if (!tenant || !userExists) {
          return res.status(401).json({
            success: false,
            code: 'ACCOUNT_DELETED',
            message: 'Your merchant account or store no longer exists. Please contact support.',
          });
        }

        if (tenant.status === 'banned') {
          return res.status(403).json({
            success: false,
            code: 'ACCOUNT_BANNED',
            message: 'Your merchant account has been banned. Please contact support.',
          });
        }
        // Suspended: read-only, except support/billing/subscription so the merchant can resolve the issue
        if (tenant?.status === 'suspended') {
          const isReadOnly = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
          const url = req.originalUrl || '';
          const isResolutionRoute = /\/(support|billing|subscriptions|auth)(\/|\?|$)/.test(url);
          if (!isReadOnly && !isResolutionRoute) {
            return res.status(403).json({
              success: false,
              code: 'ACCOUNT_SUSPENDED',
              message: 'Your account is suspended. You have read-only access. Please contact support.',
            });
          }
        }
      }

      req.user = verifiedUser;
      
      // Apply role-based rate limiting automatically to all protected routes
      return roleBasedRateLimiter(req, res, next);
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };
};
