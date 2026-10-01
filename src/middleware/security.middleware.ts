import { Request, Response, NextFunction } from 'express';
import { BlockedIp, SecurityLog } from '../modules/system/security.model';
import { getClientIp, isCloudflareProxyIp } from '../utils/ipHelper';

// ──────────────────────────────────────────────────────────────────────────────
// Blocked IPs Cache  (rebuilt from DB every 60s; bounded by DB size)
// ──────────────────────────────────────────────────────────────────────────────
let blockedIpsCache: Set<string> = new Set();
let lastCacheUpdate = 0;
const BLOCKED_IP_CACHE_TTL = 60 * 1000; // 1 minute

const refreshBlockedIpsCache = async () => {
  try {
    const blocked = await BlockedIp.find({
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
    }).select('ipAddress');

    // Exclude any legacy Cloudflare proxy edge IPs from the active block cache
    const validBlockedIps = blocked
      .map(b => b.ipAddress)
      .filter(ip => !isCloudflareProxyIp(ip));

    blockedIpsCache = new Set(validBlockedIps); // Full replacement — always bounded by DB
    lastCacheUpdate = Date.now();
  } catch (error) {
    console.error('Failed to refresh Blocked IPs cache:', error);
  }
};

export const ipBlocklistMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  // Always bypass blocklist for internal Socket.IO polling & websocket handshakes
  if (req.originalUrl.startsWith('/socket.io')) {
    return next();
  }

  const ip = getClientIp(req);

  // Refresh cache if stale (non-blocking — awaited here intentionally for correctness)
  if (Date.now() - lastCacheUpdate > BLOCKED_IP_CACHE_TTL) {
    await refreshBlockedIpsCache();
  }

  // Never block Cloudflare proxy edge node IPs directly
  if (!isCloudflareProxyIp(ip) && blockedIpsCache.has(ip)) {
    return res.status(403).json({
      success: false,
      message: 'Your IP address has been blocked due to suspicious activity or policy violations.'
    });
  }

  next();
};

// ──────────────────────────────────────────────────────────────────────────────
// Attack Warning Cache  (2-strike rule for XSS / path traversal detection)
// Stores the timestamp of the first warning per IP.
// Uses per-entry TTL eviction (not blunt .clear()) so active attackers are
// tracked continuously while long-idle IPs are cleaned up automatically.
// ──────────────────────────────────────────────────────────────────────────────
const WARNING_TTL = 60 * 60 * 1000;      // 1-hour rolling window per IP
const WARNING_CACHE_MAX_SIZE = 2000;      // safety cap — ~40 bytes each = ~80 KB max

interface WarningEntry { timestamp: number; expiresAt: number; }
const warningCache = new Map<string, WarningEntry>();

// Evict expired entries every 30 minutes — .unref() so it never blocks graceful shutdown
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of warningCache.entries()) {
    if (now >= entry.expiresAt) warningCache.delete(ip);
  }
  // Hard cap: if still too large after TTL sweep, evict the oldest surplus entries
  if (warningCache.size > WARNING_CACHE_MAX_SIZE) {
    const overflow = warningCache.size - WARNING_CACHE_MAX_SIZE;
    let dropped = 0;
    for (const key of warningCache.keys()) {
      if (dropped++ >= overflow) break;
      warningCache.delete(key);
    }
  }
}, 30 * 60 * 1000).unref();

// Helper to determine exact source app based on Origin/Referer
export const getRequestedFrom = (req: Request): string => {
  const origin = req.headers.origin || req.headers.referer || '';
  if (origin.includes('3000') || origin.includes('3001')) return 'Merchant Dashboard';
  if (origin.includes('5173') || origin.includes('5174') || origin.includes('admin')) return 'Super Admin Dashboard';
  if (origin.includes('3002') || origin.includes('localhost') || origin.includes('.')) return 'Web Store';
  return 'Mobile App / Unknown';
};

export const attackDetectionMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const ip = getClientIp(req);

  // Never evaluate or block Cloudflare proxy node IPs or internal Socket.IO polling
  if (isCloudflareProxyIp(ip) || req.originalUrl.startsWith('/socket.io')) {
    return next();
  }

  const payloadStr = JSON.stringify(req.body || {}) + JSON.stringify(req.query || {}) + req.originalUrl;

  // Basic heuristic for malicious payload (XSS tags, inline JS)
  const isSuspicious = /(<script>|<\/script>|javascript:)/i.test(payloadStr);

  // Critical files and path traversal attempts → immediate 1-strike ban
  const isCriticalAttack = /(\.env|config\.json|passwd|shadow|\.\.\/|\.\.\\|%2e%2e)/i.test(payloadStr);

  if (isCriticalAttack || isSuspicious) {
    try {
      const requestedFrom = getRequestedFrom(req);

      await SecurityLog.create({
        incidentType: 'ATTACK_DETECTED',
        endpoint: req.originalUrl,
        ipAddress: ip,
        reason: isCriticalAttack
          ? 'Immediate Block: Attempted to access sensitive system files or path traversal'
          : 'Suspicious payload matching known XSS/NoSQLi signatures',
        requestedFrom,
        userAgent: req.headers['user-agent'] || 'Unknown'
      });

      const now = Date.now();
      const existing = warningCache.get(ip);
      // A warning is "valid" if it was set and hasn't expired yet
      const hasValidWarning = existing && now < existing.expiresAt;

      // Critical attack → immediate block; otherwise two-strike rule
      if (isCriticalAttack || hasValidWarning) {
        await BlockedIp.create({
          ipAddress: ip,
          reason: isCriticalAttack
            ? '[AUTO-BLOCKED] Critical Attack: File Traversal / System File Access'
            : '[AUTO-BLOCKED] Repeated Malicious Activity (2 strikes)',
          type: 'auto',
          userAgent: req.headers['user-agent'] || 'Unknown'
        });
        blockedIpsCache.add(ip);
        warningCache.delete(ip); // Free memory immediately after block
        return res.status(403).json({ success: false, message: 'IP address permanently blocked due to malicious activity.' });
      } else {
        // Record first strike with its own TTL
        warningCache.set(ip, { timestamp: now, expiresAt: now + WARNING_TTL });
        return res.status(403).json({ success: false, message: 'Malicious payload detected. This incident has been logged. Further attempts will result in an IP ban.' });
      }
    } catch (_err) {
      // Absorb silently — never let security middleware crash the request pipeline
    }
  }

  next();
};
