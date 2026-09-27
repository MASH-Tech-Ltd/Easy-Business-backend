import { Request, Response, NextFunction } from 'express';
import { VisitorLog } from '../modules/system/security.model';
import { getClientIp, isCloudflareProxyIp } from '../utils/ipHelper';

// In-memory TTL cache to deduplicate visitor logs per (IP + store)
const visitorLogCache = new Map<string, number>();
const VISITOR_LOG_TTL = 30 * 60 * 1000; // 30 minutes

// Cleanup cache periodically to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of visitorLogCache.entries()) {
    if (now - timestamp > VISITOR_LOG_TTL) {
      visitorLogCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Middleware that automatically tracks storefront visitors across all web store frontends
 */
export const visitorTrackingMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = getClientIp(req);

    // Skip Cloudflare edge proxies or loopback
    if (isCloudflareProxyIp(ip)) {
      return next();
    }

    const tenant = (req as any).tenant;
    const storeName = tenant?.name || tenant?.slug || (req.headers.host ? req.headers.host.split(':')[0] : 'Web Store');
    const cacheKey = `${ip}_${storeName}`;
    const now = Date.now();

    const lastLogTime = visitorLogCache.get(cacheKey);
    if (!lastLogTime || (now - lastLogTime > VISITOR_LOG_TTL)) {
      visitorLogCache.set(cacheKey, now);

      // Asynchronous non-blocking visitor log creation
      VisitorLog.create({
        role: 'Customer',
        ipAddress: ip,
        userAgent: req.headers['user-agent'] || 'Unknown',
        storeName: storeName,
        ownerName: 'Storefront Visitor',
      }).catch(err => {
        console.error('Visitor tracking log error:', err);
      });
    }
  } catch (err) {
    // Non-blocking error handler
  }

  next();
};
