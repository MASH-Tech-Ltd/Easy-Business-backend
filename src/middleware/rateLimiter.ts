import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { SecurityLog, BlockedIp } from '../modules/system/security.model';
import { getRequestedFrom } from './security.middleware';
import { getClientIp, isCloudflareProxyIp } from '../utils/ipHelper';

// Global baseline rate limiter for all unauthenticated routes (e.g. login, public APIs)
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1500, // Increased limit for storefront public APIs
  message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => getClientIp(req),
});

// In-memory cache for warnings (10-strike rule)
const warningCache: Map<string, number> = new Map();

// Clear warning cache every 2 hours to prevent memory leaks from inactive IPs
setInterval(() => {
  warningCache.clear();
}, 2 * 60 * 60 * 1000);

// Custom Rate Limiter Factory
export const customRateLimit = (windowMs: number, max: number, messageText: string) => {
  return rateLimit({
    windowMs,
    max,
    message: { success: false, message: messageText },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => getClientIp(req),
    handler: async (req: Request, res: Response, next: NextFunction, options) => {
      const ip = getClientIp(req);
      
      try {
        await SecurityLog.create({
          incidentType: 'RATE_LIMIT',
          endpoint: req.originalUrl,
          ipAddress: ip,
          reason: `Rate limit exceeded (${max} req / ${windowMs / 1000 / 60}m): ${messageText}`,
          requestedFrom: getRequestedFrom(req),
          userAgent: req.headers['user-agent'] || 'Unknown'
        });

        // 10-strike rule for real IPs (never block Cloudflare edge proxy node IPs directly)
        if (!isCloudflareProxyIp(ip)) {
          const strikes = (warningCache.get(ip) || 0) + 1;
          if (strikes >= 10) {
            await BlockedIp.create({
              ipAddress: ip,
              reason: '[AUTO-BLOCKED] Repeated Rate Limit Violations (10 strikes)',
              type: 'auto',
              userAgent: req.headers['user-agent'] || 'Unknown'
            });
            warningCache.delete(ip);
          } else {
            warningCache.set(ip, strikes);
          }
        }
      } catch (err) {}

      res.status(options.statusCode).json(options.message);
    }
  });
};

// Role-based rate limiter middleware
export const roleBasedRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req: Request) => {
    const role = req.user?.role;
    if (role === 'super_admin') return 1000;
    if (role === 'tenant_admin') return 500;
    if (role === 'customer' || role === 'store_admin') return 250;
    return 200;
  },
  keyGenerator: (req: Request, res: Response) => {
    return req.user?.userId || getClientIp(req);
  },
  message: (req: Request, res: Response) => {
    return { success: false, message: `Rate limit exceeded for your role.` };
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req: Request, res: Response, next: NextFunction, options) => {
    const ip = getClientIp(req);
    
    try {
      await SecurityLog.create({
        incidentType: 'RATE_LIMIT',
        endpoint: req.originalUrl,
        ipAddress: ip,
        reason: typeof options.message === 'function' ? options.message(req, res) : (options.message as any).message,
        requestedFrom: getRequestedFrom(req),
        user: req.user?.userId || 'Anonymous',
        userAgent: req.headers['user-agent'] || 'Unknown'
      });

      if (!isCloudflareProxyIp(ip)) {
        const strikes = (warningCache.get(ip) || 0) + 1;
        if (strikes >= 20) {
          await BlockedIp.create({
            ipAddress: ip,
            reason: '[AUTO-BLOCKED] Repeated Role Rate Limit Violations (20 strikes)',
            type: 'auto',
            userAgent: req.headers['user-agent'] || 'Unknown'
          });
          warningCache.delete(ip);
        } else {
          warningCache.set(ip, strikes);
        }
      }
    } catch (err) {}

    res.status(options.statusCode).json(typeof options.message === 'function' ? options.message(req, res) : options.message);
  }
});
