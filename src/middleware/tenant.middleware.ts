import { Request, Response, NextFunction } from 'express';
import { Tenant } from '../modules/tenant/tenant.model';
import ApiResponse from '../utils/apiResponse';
import config from '../config';

export const tenantMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || req.hostname || '';
    const host = rawHost.split(':')[0] || '';
    
    // Example: "abcstore.myplatform.com"
    // Extract subdomain
    let isCustomDomain = false;
    let slugOrDomain = '';

    const baseDomain = config.app.baseDomain || 'localhost'; // fallback for local

    if (host.includes(baseDomain) && host !== baseDomain) {
      // It's a subdomain
      slugOrDomain = host.split('.')[0] || '';
    } else if (host !== baseDomain) {
      // It's a custom domain
      isCustomDomain = true;
      slugOrDomain = host;
    }

    if (!slugOrDomain) {
      // No tenant domain/subdomain identified, probably main site
      return next(); 
    }

    let tenant;
    if (isCustomDomain) {
      tenant = await Tenant.findOne({ customDomain: slugOrDomain, status: 'active' });
    } else {
      tenant = await Tenant.findOne({ slug: slugOrDomain, status: 'active' });
    }

    if (!tenant) {
      return ApiResponse.sendError(res, 404, 'Store not found or suspended');
    }

    // Attach tenant info to request
    (req as any).tenantId = tenant._id;
    (req as any).tenant = tenant;

    next();
  } catch (error) {
    next(error);
  }
};
