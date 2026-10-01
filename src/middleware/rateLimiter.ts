import rateLimit, { Store } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { SecurityLog, BlockedIp } from '../modules/system/security.model';
import { getRequestedFrom } from './security.middleware';
import { getClientIp, isCloudflareProxyIp } from '../utils/ipHelper';

// ──────────────────────────────────────────────────────────────────────────────
// Bounded MemoryStore for express-rate-limit
// The default MemoryStore has NO size cap — under a DDoS with thousands of unique
// IPs, each limiter instance grows unbounded. This store enforces a hard cap and
// evicts the oldest 20% of entries when the limit is hit.
// ──────────────────────────────────────────────────────────────────────────────
class BoundedMemoryStore implements Store {
  private hits = new Map<string, { count: number; resetTime: Date }>();
  private readonly maxSize: number;
  private windowMs: number;

  constructor(maxSize = 20_000) {
    this.maxSize = maxSize;
    this.windowMs = 60_000; // will be overwritten by init()
  }

  init(options: { windowMs: number }) {
    this.windowMs = options.windowMs;
  }

  async increment(key: string) {
    const now = Date.now();
    const existing = this.hits.get(key);

    if (existing && existing.resetTime.getTime() > now) {
      existing.count++;
      return { totalHits: existing.count, resetTime: existing.resetTime };
    }

    const resetTime = new Date(now + this.windowMs);
    this.hits.set(key, { count: 1, resetTime });

    // Evict oldest 20% when cap is exceeded
    if (this.hits.size > this.maxSize) {
      const overflow = Math.ceil(this.hits.size * 0.20);
      let dropped = 0;
      for (const k of this.hits.keys()) {
        if (dropped++ >= overflow) break;
        this.hits.delete(k);
      }
    }

    return { totalHits: 1, resetTime };
  }

  async decrement(key: string) {
    const existing = this.hits.get(key);
    if (existing && existing.count > 0) existing.count--;
  }

  async resetKey(key: string) {
    this.hits.delete(key);
  }

  async resetAll() {
    this.hits.clear();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared warning / strike cache
// Stores { count, expiresAt } per IP so each IP's window is tracked independently.
// Blunt .clear() was replaced with per-entry TTL eviction — avoids resetting
// active abusers mid-window while still preventing unbounded memory growth.
// ──────────────────────────────────────────────────────────────────────────────
const WARNING_WINDOW_MS = 2 * 60 * 60 * 1000; // 2-hour rolling window per IP
const WARNING_CACHE_MAX_SIZE = 5000;            // safety cap — ~40 bytes each = ~200 KB max

interface StrikeEntry { count: number; expiresAt: number; }
const warningCache = new Map<string, StrikeEntry>();

// Evict expired entries every 30 minutes — never blocks process shutdown
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of warningCache.entries()) {
    if (now >= entry.expiresAt) warningCache.delete(ip);
  }
  // Hard cap: if still too large after TTL sweep, drop the oldest 20%
  if (warningCache.size > WARNING_CACHE_MAX_SIZE) {
    const overflow = warningCache.size - WARNING_CACHE_MAX_SIZE;
    let dropped = 0;
    for (const key of warningCache.keys()) {
      if (dropped++ >= overflow) break;
      warningCache.delete(key);
    }
  }
}, 30 * 60 * 1000).unref();

/**
 * Internal helper: log rate-limit violation and apply N-strike auto-block rule.
 * @param ip         The real client IP
 * @param req        Express Request (for logging context)
 * @param maxStrikes Number of violations before IP is auto-banned
 * @param reason     Human-readable reason string for the security log
 */
const handleRateLimitViolation = async (
  ip: string,
  req: Request,
  maxStrikes: number,
  reason: string,
) => {
  try {
    await SecurityLog.create({
      incidentType: 'RATE_LIMIT',
      endpoint: req.originalUrl,
      ipAddress: ip,
      reason,
      requestedFrom: getRequestedFrom(req),
      userAgent: req.headers['user-agent'] || 'Unknown',
    });

    // Never auto-block Cloudflare edge proxy node IPs
    if (!isCloudflareProxyIp(ip)) {
      const now = Date.now();
      const existing = warningCache.get(ip);

      // Reset if the previous window has expired (rolling per-IP window)
      const currentCount = (existing && now < existing.expiresAt) ? existing.count : 0;
      const newCount = currentCount + 1;

      if (newCount >= maxStrikes) {
        await BlockedIp.create({
          ipAddress: ip,
          reason: `[AUTO-BLOCKED] Repeated Rate Limit Violations (${newCount} strikes)`,
          type: 'auto',
          userAgent: req.headers['user-agent'] || 'Unknown',
        });
        warningCache.delete(ip); // Free memory immediately on block
      } else {
        warningCache.set(ip, { count: newCount, expiresAt: now + WARNING_WINDOW_MS });
      }
    }
  } catch (_err) {
    // Never throw from rate limit handler — just absorb silently
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 1. GLOBAL RATE LIMITER  (production-only, applied before all routes in app.ts)
//    Catches absolute abuse scenarios before any routes are matched.
// ──────────────────────────────────────────────────────────────────────────────
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000,                  // 2 000 req / IP / 15 min — generous for real users
  message: { success: false, message: 'Too many requests. Please slow down and try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new BoundedMemoryStore(50_000),
  keyGenerator: (req: Request) => getClientIp(req),
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. STOREFRONT / PUBLIC PRODUCT LISTING LIMITER
//    Used on /storefront/:slug/products, /categories, /brands, /info, /theme etc.
//    Real store visitors browse a lot — this must be very permissive.
// ──────────────────────────────────────────────────────────────────────────────
export const storefrontPublicLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute window
  max: 120,                   // 120 req / min — approx 2 req/sec (covers rapid browsing, infinite scroll, etc.)
  message: { success: false, message: 'You are browsing too fast. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new BoundedMemoryStore(20_000),
  keyGenerator: (req: Request) => getClientIp(req),
  handler: async (req: Request, res: Response, _next: NextFunction, options) => {
    const ip = getClientIp(req);
    await handleRateLimitViolation(ip, req, 20, `Storefront browse limit exceeded (${options.max}/min)`);
    res.status(options.statusCode).json(options.message);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. SEARCH LIMITER
//    Applied to /storefront/:slug/products?search=... (the search endpoint).
//    Frontend already debounces 1 second — this adds server-side protection.
//    Must be generous enough for real typing, but limit bots hammering search.
// ──────────────────────────────────────────────────────────────────────────────
export const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute window
  max: 60,                    // 60 search req / min (1/sec) — perfect for 1s debounce
  message: { success: false, message: 'Search rate limit reached. Please wait a moment before searching again.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new BoundedMemoryStore(10_000),
  keyGenerator: (req: Request) => getClientIp(req),
  handler: async (req: Request, res: Response, _next: NextFunction, options) => {
    const ip = getClientIp(req);
    await handleRateLimitViolation(ip, req, 15, `Search limit exceeded (${options.max}/min)`);
    res.status(options.statusCode).json(options.message);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. CHECKOUT / ORDER CREATION LIMITER
//    Prevents order spam and ensures each customer can place orders reasonably.
// ──────────────────────────────────────────────────────────────────────────────
export const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15,                    // 15 orders per IP per 10 min (generous for real users)
  message: { success: false, message: 'Too many orders placed from this device. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new BoundedMemoryStore(5_000),
  keyGenerator: (req: Request) => getClientIp(req),
  handler: async (req: Request, res: Response, _next: NextFunction, options) => {
    const ip = getClientIp(req);
    await handleRateLimitViolation(ip, req, 5, `Checkout limit exceeded (${options.max}/10min)`);
    res.status(options.statusCode).json(options.message);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. CHECKOUT LEADS / ABANDONED CART TRACKING LIMITER
//    These fire automatically via debounce — must be very permissive.
// ──────────────────────────────────────────────────────────────────────────────
export const checkoutLeadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 minutes
  max: 30,                    // 30 lead pings per IP per 5 min
  message: { success: false, message: 'Too many tracking requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new BoundedMemoryStore(10_000),
  keyGenerator: (req: Request) => getClientIp(req),
  // Silent handler — don't log or ban for this, it's automatic client-side
  handler: async (req: Request, res: Response, _next: NextFunction, options) => {
    res.status(options.statusCode).json(options.message);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. AUTH LIMITER  (login, register, password reset)
//    Very strict — brute force protection.
// ──────────────────────────────────────────────────────────────────────────────
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                    // 20 attempts per IP per 15 min
  message: { success: false, message: 'Too many login attempts. Please wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new BoundedMemoryStore(10_000),
  keyGenerator: (req: Request) => getClientIp(req),
  handler: async (req: Request, res: Response, _next: NextFunction, options) => {
    const ip = getClientIp(req);
    await handleRateLimitViolation(ip, req, 5, `Auth limit exceeded (${options.max}/15min) — possible brute force`);
    res.status(options.statusCode).json(options.message);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. DASHBOARD API LIMITER  (tenant_admin authenticated routes)
//    Authenticated dashboard users get a generous limit.
// ──────────────────────────────────────────────────────────────────────────────
export const dashboardLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max: 200,                   // 200 req / min for authenticated dashboard users
  message: { success: false, message: 'Dashboard API rate limit exceeded. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new BoundedMemoryStore(10_000),
  keyGenerator: (req: Request) => req.user?.userId || getClientIp(req),
  handler: async (req: Request, res: Response, _next: NextFunction, options) => {
    const ip = getClientIp(req);
    await handleRateLimitViolation(ip, req, 30, `Dashboard limit exceeded (${options.max}/min)`);
    res.status(options.statusCode).json(options.message);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. UPLOAD / WRITE OPERATION LIMITER  (product create/update with image upload)
// ──────────────────────────────────────────────────────────────────────────────
export const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 minutes
  max: 50,                    // 50 uploads per 5 min — enough for bulk product adds
  message: { success: false, message: 'Upload rate limit exceeded. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new BoundedMemoryStore(5_000),
  keyGenerator: (req: Request) => req.user?.userId || getClientIp(req),
  handler: async (req: Request, res: Response, _next: NextFunction, options) => {
    const ip = getClientIp(req);
    await handleRateLimitViolation(ip, req, 10, `Upload limit exceeded (${options.max}/5min)`);
    res.status(options.statusCode).json(options.message);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// LEGACY: Custom Rate Limiter Factory (kept for backward compatibility)
// ──────────────────────────────────────────────────────────────────────────────
export const customRateLimit = (windowMs: number, max: number, messageText: string) => {
  return rateLimit({
    windowMs,
    max,
    message: { success: false, message: messageText },
    standardHeaders: true,
    legacyHeaders: false,
    store: new BoundedMemoryStore(5_000),
    keyGenerator: (req: Request) => getClientIp(req),
    handler: async (req: Request, res: Response, _next: NextFunction, options) => {
      const ip = getClientIp(req);
      await handleRateLimitViolation(ip, req, 10, `Rate limit exceeded (${max} req / ${windowMs / 1000 / 60}m): ${messageText}`);
      res.status(options.statusCode).json(options.message);
    },
  });
};

// ──────────────────────────────────────────────────────────────────────────────
// LEGACY: Role-based rate limiter (kept for backward compatibility)
// ──────────────────────────────────────────────────────────────────────────────
export const roleBasedRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req: Request) => {
    const role = req.user?.role;
    if (role === 'super_admin') return 5000;
    if (role === 'tenant_admin') return 2000;
    if (role === 'customer' || role === 'store_admin') return 500;
    return 300;
  },
  keyGenerator: (req: Request) => req.user?.userId || getClientIp(req),
  message: { success: false, message: 'Rate limit exceeded for your role.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new BoundedMemoryStore(10_000),
  handler: async (req: Request, res: Response, _next: NextFunction, options) => {
    const ip = getClientIp(req);
    await handleRateLimitViolation(ip, req, 20, 'Role-based rate limit exceeded');
    res.status(options.statusCode).json(options.message);
  },
});
