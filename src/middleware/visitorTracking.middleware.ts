import { Request, Response, NextFunction } from 'express';
import { VisitorLog } from '../modules/system/security.model';
import { getClientIp, isCloudflareProxyIp } from '../utils/ipHelper';

// ──────────────────────────────────────────────────────────────────────────────
// Visitor dedup cache — (IP + store) → last log timestamp
// ──────────────────────────────────────────────────────────────────────────────
const visitorLogCache = new Map<string, number>();
const VISITOR_LOG_TTL = 5 * 60 * 1000;  // 5 minutes — same visitor won't log twice
const VISITOR_CACHE_MAX_SIZE = 10_000;   // safety cap: 10k entries × ~80 bytes ≈ 800 KB max

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of visitorLogCache.entries()) {
    if (now - timestamp > VISITOR_LOG_TTL) visitorLogCache.delete(key);
  }
  if (visitorLogCache.size > VISITOR_CACHE_MAX_SIZE) {
    const overflow = Math.ceil(visitorLogCache.size * 0.25);
    let dropped = 0;
    for (const key of visitorLogCache.keys()) {
      if (dropped++ >= overflow) break;
      visitorLogCache.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

// ──────────────────────────────────────────────────────────────────────────────
// ip-api.com global request throttle
// Free tier allows 45 req/min. We track calls in a 60s sliding window.
// If we hit the limit we fall back to Cloudflare country header immediately
// instead of making a doomed request that returns an error JSON.
// ──────────────────────────────────────────────────────────────────────────────
const IP_API_MAX_PER_MIN = 40;     // stay safely below the 45/min limit
const IP_API_WINDOW_MS  = 60_000;  // 1-minute window
let ipApiCallCount = 0;
let ipApiWindowStart = Date.now();

const canCallIpApi = (): boolean => {
  const now = Date.now();
  if (now - ipApiWindowStart > IP_API_WINDOW_MS) {
    // New window — reset counter
    ipApiCallCount = 0;
    ipApiWindowStart = now;
  }
  if (ipApiCallCount >= IP_API_MAX_PER_MIN) return false;
  ipApiCallCount++;
  return true;
};

// ──────────────────────────────────────────────────────────────────────────────
// Lightweight UA parser — no external dependency
// Detects device type (Mobile / Tablet / Desktop) and browser family
// from the raw User-Agent string using well-known signal strings.
// ──────────────────────────────────────────────────────────────────────────────
const parseUserAgent = (ua: string): { device: string; browser: string } => {
  const u = ua.toLowerCase();

  // Device
  let device = 'Desktop';
  if (/ipad|tablet|(android(?!.*mobile))|kindle|silk|playbook/i.test(ua)) {
    device = 'Tablet';
  } else if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|bb10|mini|palm|symbian/i.test(ua)) {
    device = 'Mobile';
  }

  // Browser — order matters (more specific first)
  let browser = 'Other';
  if (u.includes('edg/') || u.includes('edge/'))          browser = 'Edge';
  else if (u.includes('opr/') || u.includes('opera'))     browser = 'Opera';
  else if (u.includes('samsung'))                          browser = 'Samsung Browser';
  else if (u.includes('firefox') || u.includes('fxios'))  browser = 'Firefox';
  else if (u.includes('chrome') || u.includes('crios'))   browser = 'Chrome';
  else if (u.includes('safari') && u.includes('version')) browser = 'Safari';
  else if (u.includes('msie') || u.includes('trident'))   browser = 'Internet Explorer';

  return { device, browser };
};

/**
 * Middleware that automatically tracks real storefront visitors across all web store frontends.
 * Non-blocking: visitor log creation happens in a detached async IIFE with a 3s timeout on geo lookup.
 */
export const visitorTrackingMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userAgent = req.headers['user-agent'] || '';
    const userAgentLower = userAgent.toLowerCase();

    // Skip server-to-server SSR calls (Next.js server fetch, node, curl, postman, uptime bots)
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

    // Skip known search engine crawlers and bots
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
      (userAgentLower.includes('bot') && userAgentLower.includes('crawler')) ||
      userAgentLower.includes('spider') ||
      userAgentLower.includes('headlesschrome') ||
      userAgentLower.includes('phantomjs')
    ) {
      return next();
    }

    const ip = getClientIp(req);

    // Skip Cloudflare edge proxy node IPs
    if (isCloudflareProxyIp(ip)) return next();

    // Skip known Googlebot IP range: 66.249.64.0/19
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
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const hostDomain = rawHost.split(':')[0] || '';

    let refererDomain = '';
    const referer = (req.headers.referer || req.headers.origin || '') as string;
    if (referer) {
      try { refererDomain = new URL(referer).hostname; } catch (_e) {}
    }

    // Never classify direct backend API calls (no tenant) as storefront visits
    const ignoredBackendDomains = ['backapi.masheco.com', 'adminsec.masheco.com', 'localhost:8000', '127.0.0.1:8000'];
    if (ignoredBackendDomains.includes(hostDomain) && !tenant && (!refererDomain || ignoredBackendDomains.includes(refererDomain))) {
      return next();
    }

    // Determine clean store display name & domain
    let storeName = '';
    if (tenant?.name)                                 storeName = tenant.name;
    else if (tenant?.customDomain || tenant?.domain)  storeName = tenant.customDomain || tenant.domain;
    else if (tenant?.slug)                            storeName = `${tenant.slug}.masheco.com`;
    else if (refererDomain && !ignoredBackendDomains.includes(refererDomain))  storeName = refererDomain;
    else if (hostDomain && !ignoredBackendDomains.includes(hostDomain) && hostDomain !== 'localhost' && hostDomain !== '127.0.0.1') storeName = hostDomain;

    if (!storeName) return next();

    // Determine role based on context
    let role: 'Customer' | 'Merchant' | 'Super Admin' | 'Guest' = 'Guest';
    let displayStoreName = storeName;
    let ownerName = 'Store Visitor-Guest';

    if (storeName === 'masheco.com' || storeName === 'www.masheco.com') {
      role = 'Guest'; ownerName = 'Landing Guest';
    } else if (storeName.includes('merchant')) {
      role = 'Merchant'; displayStoreName = 'Merchant Dashboard'; ownerName = 'Merchant';
    } else if (storeName === 'adminsec.masheco.com' || storeName.includes('admin')) {
      role = 'Super Admin'; displayStoreName = 'Super Admin Dashboard'; ownerName = 'Authority';
    }

    const cacheKey = `${ip}_${storeName}`;
    const now = Date.now();
    const lastLogTime = visitorLogCache.get(cacheKey);

    if (!lastLogTime || (now - lastLogTime > VISITOR_LOG_TTL)) {
      visitorLogCache.set(cacheKey, now);

      // Emergency eviction if cache hit the hard cap between scheduled sweeps
      if (visitorLogCache.size > VISITOR_CACHE_MAX_SIZE) {
        const overflow = Math.ceil(visitorLogCache.size * 0.10);
        let dropped = 0;
        for (const key of visitorLogCache.keys()) {
          if (dropped++ >= overflow) break;
          visitorLogCache.delete(key);
        }
      }

      // Parse device and browser from UA string — lightweight, no dependency
      const { device, browser } = parseUserAgent(userAgent);

      // Capture Cloudflare country header NOW (before the async IIFE where req may be GC'd)
      const cfCountry = req.headers['cf-ipcountry'] as string | undefined;

      // Non-blocking: geo lookup + DB write in detached IIFE
      (async () => {
        let location = 'Unknown';

        // Only call ip-api.com if within our self-imposed rate limit (40/min)
        if (canCallIpApi()) {
          try {
            // 3-second timeout — prevents hanging promises if ip-api.com is slow/down
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);

            const response = await fetch(
              `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,zip,isp`,
              { signal: controller.signal }
            );
            clearTimeout(timeout);

            if (response.ok) {
              const data = await response.json();
              if (data.status === 'success') {
                const parts: string[] = [];
                if (data.city) parts.push(data.city);
                if (data.regionName && data.regionName !== data.city) parts.push(data.regionName);
                if (data.country) parts.push(data.country);
                let loc = parts.join(', ');
                if (data.zip) loc += ` - ${data.zip}`;
                if (data.isp) loc += ` (ISP: ${data.isp})`;
                location = loc;
              }
            }
          } catch (_e) {
            // Timeout (AbortError) or network error — fall through to CF header
          }
        }

        // Fallback: Cloudflare country header (always available when behind CF, no rate limit)
        if (location === 'Unknown' && cfCountry && cfCountry !== 'XX') {
          location = cfCountry;
        }

        await VisitorLog.create({
          role,
          ipAddress: ip,
          userAgent: `[${device}] [${browser}] ${userAgent}`.slice(0, 512), // structured prefix + raw UA, capped
          storeName: displayStoreName,
          ownerName,
          location,
        });
      })().catch(err => {
        console.error('Visitor tracking log error:', err);
      });
    }
  } catch (_err) {
    // Non-blocking — never crash the request pipeline
  }

  next();
};
