import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { SecurityLog, BlockedIp } from '../modules/system/security.model';
import { getRequestedFrom } from './security.middleware';



// Global baseline rate limiter for all unauthenticated routes (e.g. login, public APIs)
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// In-memory cache for warnings (two-strike rule)
const warningCache: Map<string, number> = new Map();

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

        // Two-strike rule: First time warn, second time block
        if (warningCache.has(ip)) {
          await BlockedIp.create({
            ipAddress: ip,
            reason: '[AUTO-BLOCKED] Repeated Rate Limit Violations (2 strikes)',
            type: 'auto'
          });
          warningCache.delete(ip);
        } else {
          warningCache.set(ip, Date.now());
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
    if (role === 'tenant_admin') return 300;
    if (role === 'customer' || role === 'store_admin') return 100;
    return 100;
  },
  keyGenerator: (req: Request, res: Response) => {
    // Use user ID if available, otherwise fallback to IP
    return req.user?.userId || req.ip || req.socket.remoteAddress || '127.0.0.1';
  },
  message: (req: Request) => {
    const role = req.user?.role;
    const maxRequests = role === 'super_admin' ? 1000 : role === 'tenant_admin' ? 300 : (role === 'customer' || role === 'store_admin') ? 50 : 100;
    return { success: false, message: `Rate limit exceeded for your role (${role || 'guest'}). Limit is ${maxRequests} requests per 15 minutes.` };
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

      // Two-strike rule: First time warn, second time block
      if (warningCache.has(ip)) {
        await BlockedIp.create({
          ipAddress: ip,
          reason: '[AUTO-BLOCKED] Repeated Role Rate Limit Violations (2 strikes)',
          type: 'auto'
        });
        warningCache.delete(ip);
      } else {
        warningCache.set(ip, Date.now());
      }
    } catch (err) {}

    res.status(options.statusCode).json(typeof options.message === 'function' ? options.message(req, res) : options.message);
  }
});
