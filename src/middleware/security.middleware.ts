import { Request, Response, NextFunction } from 'express';
import { BlockedIp, SecurityLog } from '../modules/system/security.model';

// In-memory cache for blocked IPs to avoid querying the DB on every single request
let blockedIpsCache: Set<string> = new Set();
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

const refreshBlockedIpsCache = async () => {
  try {
    const blocked = await BlockedIp.find({
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
    }).select('ipAddress');
    blockedIpsCache = new Set(blocked.map(b => b.ipAddress));
    lastCacheUpdate = Date.now();
  } catch (error) {
    console.error('Failed to refresh Blocked IPs cache:', error);
  }
};

export const ipBlocklistMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';

  // Refresh cache if stale
  if (Date.now() - lastCacheUpdate > CACHE_TTL) {
    await refreshBlockedIpsCache();
  }

  if (blockedIpsCache.has(ip)) {
    return res.status(403).json({
      success: false,
      message: 'Your IP address has been blocked due to suspicious activity or policy violations.'
    });
  }

  next();
};

// In-memory cache for warnings (two-strike rule)
const warningCache: Map<string, number> = new Map();

// Helper to determine exact source app based on Origin/Referer
export const getRequestedFrom = (req: Request): string => {
  const origin = req.headers.origin || req.headers.referer || '';
  if (origin.includes('3000') || origin.includes('3001')) return 'Merchant Dashboard';
  if (origin.includes('5173') || origin.includes('5174') || origin.includes('admin')) return 'Super Admin Dashboard';
  if (origin.includes('3002') || origin.includes('localhost') || origin.includes('.')) return 'Web Store';
  return 'Mobile App / Unknown';
};

export const attackDetectionMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const payloadStr = JSON.stringify(req.body || {}) + JSON.stringify(req.query || {});
  
  // Basic heuristic for malicious payload (XSS tags, MongoDB specific operators that shouldn't be passed raw)
  const isSuspicious = /(<script>|<\/script>|\$where|\$regex|\$ne|\$gt)/i.test(payloadStr);

  if (isSuspicious) {
    try {
      const requestedFrom = getRequestedFrom(req);
      
      await SecurityLog.create({
        incidentType: 'ATTACK_DETECTED',
        endpoint: req.originalUrl,
        ipAddress: ip,
        reason: 'Suspicious payload matching known XSS/NoSQLi signatures',
        requestedFrom,
        userAgent: req.headers['user-agent'] || 'Unknown'
      });
      
      // Two-strike rule: First time warn, second time block
      if (warningCache.has(ip)) {
        await BlockedIp.create({
          ipAddress: ip,
          reason: '[AUTO-BLOCKED] Repeated Malicious Activity (2 strikes)',
          type: 'auto'
        });
        blockedIpsCache.add(ip);
        warningCache.delete(ip);
        return res.status(403).json({ success: false, message: 'IP address blocked due to repeated malicious activity.' });
      } else {
        warningCache.set(ip, Date.now());
        return res.status(403).json({ success: false, message: 'Malicious payload detected. This incident has been logged. Further attempts will result in an IP ban.' });
      }
    } catch (err) {}
  }

  next();
};
