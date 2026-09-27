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
 * Middleware that automatically tracks real storefront visitors across all web store frontends
 */
export const visitorTrackingMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userAgent = req.headers['user-agent'] || '';
    const userAgentLower = userAgent.toLowerCase();

    // Skip server-to-server SSR calls (e.g. Next.js server fetch, node, curl, postman, uptime bots)
    if (
      !userAgent ||
      userAgentLower.includes('node') ||
      userAgentLower.includes('axios') ||
      userAgentLower.includes('postman') ||
      userAgentLower.includes('curl') ||
      userAgentLower.includes('python') ||
      userAgentLower.includes('go-http-client')
    ) {
      return next();
    }

    const ip = getClientIp(req);

    // Skip Cloudflare edge proxies or loopback/internal
    if (isCloudflareProxyIp(ip) || ip === '127.0.0.1' || ip === '::1') {
      return next();
    }

    const tenant = (req as any).tenant;

    // Extract real storefront host/domain
    let rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const hostDomain = rawHost.split(':')[0] || '';

    let refererDomain = '';
    const referer = (req.headers.referer || req.headers.origin || '') as string;
    if (referer) {
      try {
        refererDomain = new URL(referer).hostname;
      } catch (e) {}
    }

    // Never classify backend API or admin subdomains as Customer storefront visits
    const ignoredSystemHosts = ['backapi.masheco.com', 'adminsec.masheco.com', 'localhost'];
    if (ignoredSystemHosts.includes(hostDomain) && (!tenant && (!refererDomain || ignoredSystemHosts.includes(refererDomain)))) {
      return next();
    }

    // Determine clean store display name & domain
    let storeName = 'Web Store';
    if (tenant?.name) {
      storeName = tenant.name;
    } else if (tenant?.customDomain || tenant?.domain) {
      storeName = tenant.customDomain || tenant.domain;
    } else if (tenant?.slug) {
      storeName = `${tenant.slug}.masheco.com`;
    } else if (refererDomain && !ignoredSystemHosts.includes(refererDomain)) {
      storeName = refererDomain;
    } else if (hostDomain && !ignoredSystemHosts.includes(hostDomain)) {
      storeName = hostDomain;
    } else {
      // If we cannot identify a real store domain, skip creating a Customer visitor log
      return next();
    }

    const cacheKey = `${ip}_${storeName}`;
    const now = Date.now();

    const lastLogTime = visitorLogCache.get(cacheKey);
    if (!lastLogTime || (now - lastLogTime > VISITOR_LOG_TTL)) {
      visitorLogCache.set(cacheKey, now);

      // Asynchronous non-blocking visitor log creation
      VisitorLog.create({
        role: 'Customer',
        ipAddress: ip,
        userAgent: userAgent,
        storeName: storeName,
        ownerName: tenant?.ownerName || 'Storefront Visitor',
      }).catch(err => {
        console.error('Visitor tracking log error:', err);
      });
    }
  } catch (err) {
    // Non-blocking error handler
  }

  next();
};

