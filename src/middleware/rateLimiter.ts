import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

// Global baseline rate limiter for all unauthenticated routes (e.g. login, public APIs)
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Role-based rate limiter middleware
// This should be applied AFTER the authMiddleware so req.user is populated.
export const roleBasedRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req: Request) => {
    const role = req.user?.role;
    if (role === 'super_admin') return 1000;
    if (role === 'tenant_admin') return 300;
    if (role === 'customer' || role === 'store_admin') return 50;
    return 100;
  },
  keyGenerator: (req: Request) => {
    // Use user ID if available, otherwise fallback to IP
    return req.user?.userId || req.ip || 'unknown';
  },
  message: (req: Request) => {
    const role = req.user?.role;
    const maxRequests = role === 'super_admin' ? 1000 : role === 'tenant_admin' ? 300 : (role === 'customer' || role === 'store_admin') ? 50 : 100;
    return { success: false, message: `Rate limit exceeded for your role (${role || 'guest'}). Limit is ${maxRequests} requests per 15 minutes.` };
  },
  standardHeaders: true,
  legacyHeaders: false,
});
