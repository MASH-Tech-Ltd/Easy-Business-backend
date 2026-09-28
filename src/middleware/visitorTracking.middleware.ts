import { Request, Response, NextFunction } from 'express';
import { VisitorLog } from '../modules/system/security.model';
import { getClientIp, isCloudflareProxyIp } from '../utils/ipHelper';

// In-memory TTL cache to deduplicate visitor logs per (IP + store)
const visitorLogCache = new Map<string, number>();
const VISITOR_LOG_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup cache periodically to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of visitorLogCache.entries()) {
    if (now - timestamp > VISITOR_LOG_TTL) {
      visitorLogCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

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

    // Skip known search engine crawlers and bots — they are not real store visitors
    if (
      userAgentLower.includes('googlebot') ||
      userAgentLower.includes('google-inspectiontool') ||
      userAgentLower.includes('adsbot-google') ||
      userAgentLower.includes('mediapartners-google') ||
      userAgentLower.includes('bingbot') ||
      userAgentLower.includes('bingpreview') ||
      userAgentLower.includes('slurp') ||           // Yahoo
      userAgentLower.includes('duckduckbot') ||
      userAgentLower.includes('baiduspider') ||
      userAgentLower.includes('yandexbot') ||
      userAgentLower.includes('sogou') ||
      userAgentLower.includes('exabot') ||
      userAgentLower.includes('facebot') ||
      userAgentLower.includes('ia_archiver') ||     // Alexa/Wayback Machine
      userAgentLower.includes('semrushbot') ||
      userAgentLower.includes('ahrefsbot') ||
      userAgentLower.includes('mj12bot') ||
      userAgentLower.includes('dotbot') ||
      userAgentLower.includes('rogerbot') ||
      userAgentLower.includes('uptimerobot') ||
      userAgentLower.includes('pingdom') ||
      userAgentLower.includes('bot') && userAgentLower.includes('crawler') ||
      userAgentLower.includes('spider') ||
      userAgentLower.includes('headlesschrome') ||
      userAgentLower.includes('phantomjs')
    ) {
      return next();
    }


    const ip = getClientIp(req);

    // Skip Cloudflare edge proxy node IPs
    if (isCloudflareProxyIp(ip)) {
      return next();
    }

    // Skip known Googlebot IP range: 66.249.64.0/19 (66.249.64.x – 66.249.95.x)
    // Googlebot always uses IPs in this range — safe to block as bot traffic
    const ipParts = ip.split('.');
    if (
      ipParts.length === 4 &&
      ipParts[0] === '66' &&
      ipParts[1] === '249' &&
      parseInt(ipParts[2] || '0') >= 64 &&
      parseInt(ipParts[2] || '0') <= 95
    ) {
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

    // Never classify backend API directly (without tenant) as Customer storefront visits
    const ignoredBackendDomains = ['backapi.masheco.com', 'adminsec.masheco.com', 'localhost:8000', '127.0.0.1:8000'];
    if (ignoredBackendDomains.includes(hostDomain) && !tenant && (!refererDomain || ignoredBackendDomains.includes(refererDomain))) {
      return next();
    }

    // Determine clean store display name & domain
    let storeName = '';
    if (tenant?.name) {
      storeName = tenant.name;
    } else if (tenant?.customDomain || tenant?.domain) {
      storeName = tenant.customDomain || tenant.domain;
    } else if (tenant?.slug) {
      storeName = `${tenant.slug}.masheco.com`;
    } else if (refererDomain && !ignoredBackendDomains.includes(refererDomain)) {
      storeName = refererDomain;
    } else if (hostDomain && !ignoredBackendDomains.includes(hostDomain) && hostDomain !== 'localhost' && hostDomain !== '127.0.0.1') {
      storeName = hostDomain;
    }

    // If no store name identified, skip tracking
    if (!storeName) {
      return next();
    }

    // Determine role based on context
    let role: 'Customer' | 'Merchant' | 'Super Admin' | 'Guest' = 'Guest';
    let displayStoreName = storeName;
    let ownerName = 'Store Visitor-Guest';

    if (storeName === 'masheco.com' || storeName === 'www.masheco.com') {
      role = 'Guest';
      ownerName = 'Landing Guest';
    } else if (storeName.includes('merchant')) {
      role = 'Merchant';
      displayStoreName = 'Merchant Dashboard';
      ownerName = 'Merchant';
    } else if (storeName === 'adminsec.masheco.com' || storeName.includes('admin')) {
      role = 'Super Admin';
      displayStoreName = 'Super Admin Dashboard';
      ownerName = 'Authority';
    }

    const cacheKey = `${ip}_${storeName}`;
    const now = Date.now();

    const lastLogTime = visitorLogCache.get(cacheKey);
    if (!lastLogTime || (now - lastLogTime > VISITOR_LOG_TTL)) {
      visitorLogCache.set(cacheKey, now);

      // Asynchronous non-blocking location fetch & visitor log creation
      (async () => {
        let location = 'Unknown';
        try {
          const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,zip,isp`);
          if (response.ok) {
            const data = await response.json();
            if (data.status === 'success') {
               const parts = [];
               if (data.city) parts.push(data.city);
               if (data.regionName && data.regionName !== data.city) parts.push(data.regionName);
               if (data.country) parts.push(data.country);
               
               let loc = parts.join(', ');
               if (data.zip) loc += ` - ${data.zip}`;
               if (data.isp) loc += ` (ISP: ${data.isp})`;
               location = loc;
            }
          }
          
          // Fallback to Cloudflare header if API failed or returned nothing
          if (location === 'Unknown') {
            const cfCountry = req.headers['cf-ipcountry'];
            if (cfCountry && cfCountry !== 'XX') {
              location = cfCountry as string;
            }
          }
        } catch (e) {
          // Fallback on error
          const cfCountry = req.headers['cf-ipcountry'];
          if (cfCountry && cfCountry !== 'XX') {
            location = cfCountry as string;
          }
        }

        await VisitorLog.create({
          role: role,
          ipAddress: ip,
          userAgent: userAgent,
          storeName: displayStoreName,
          ownerName: ownerName,
          location: location,
        });
      })().catch(err => {
        console.error('Visitor tracking log error:', err);
      });
    }
  } catch (err) {
    // Non-blocking error handler
  }

  next();
};


