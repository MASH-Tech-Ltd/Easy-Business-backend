import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { SecurityLog, BlockedIp } from '../modules/system/security.model';
import { getRequestedFrom } from './security.middleware';



// Global baseline rate limiter for all unauthenticated routes (e.g. login, public APIs)
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1500, // Increased limit for storefront public APIs
  message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// In-memory cache for warnings (10-strike rule)
const warningCache: Map<string, number> = new Map();

// Clear warning cache every 24 hours to prevent memory leaks from inactive IPs
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
    handler: async (req: Request, res: Response, next: NextFunction, options) => {
      const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
      
      try {
        await SecurityLog.create({
          incidentType: 'RATE_LIMIT',
          endpoint: req.originalUrl,
          ipAddress: ip,
          reason: `Rate limit exceeded (${max} req / ${windowMs / 1000 / 60}m): ${messageText}`,
          requestedFrom: getRequestedFrom(req),
          userAgent: req.headers['user-agent'] || 'Unknown'
        });

        // 10-strike rule: First 9 times warn, 10th time block
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
      } catch (err) {}

      res.status(options.statusCode).json(options.message);
    }
  });
};

// Role-based rate limiter middleware
// This should be applied AFTER the authMiddleware so req.user is populated.
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
    // Cast req, res to any to fix TS errors while still satisfying express-rate-limit's check for ipKeyGenerator
    return req.user?.userId || ipKeyGenerator(req as any, res as any);
  },
  message: (req: Request, res: Response) => {
    const role = req.user?.role;
    const maxRequests = role === 'super_admin' ? 1000 : role === 'tenant_admin' ? 500 : (role === 'customer' || role === 'store_admin') ? 250 : 200;
    return { success: false, message: `Rate limit exceeded for your role.` };
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req: Request, res: Response, next: NextFunction, options) => {
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    
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

      // 10-strike rule: First 9 times warn, 10th time block
      const strikes = (warningCache.get(ip) || 0) + 1;
      if (strikes >= 20) {
        await BlockedIp.create({
          ipAddress: ip,
          reason: '[AUTO-BLOCKED] Repeated Role Rate Limit Violations (10 strikes)',
          type: 'auto',
          userAgent: req.headers['user-agent'] || 'Unknown'
        });
        warningCache.delete(ip);
      } else {
        warningCache.set(ip, strikes);
      }
    } catch (err) {}

    res.status(options.statusCode).json(typeof options.message === 'function' ? options.message(req, res) : options.message);
  }
});
