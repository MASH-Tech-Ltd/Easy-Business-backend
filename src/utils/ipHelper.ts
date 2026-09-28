import { Request } from 'express';

/**
 * Normalizes IPv4 / IPv6 addresses and extracts IPv4 if IPv6-mapped (e.g. ::ffff:192.168.1.1)
 */
const cleanIp = (ip: string): string => {
  if (!ip) return '127.0.0.1';
  let cleaned = ip.trim();
  if (cleaned.includes(',')) {
    const [first] = cleaned.split(',');
    cleaned = (first ?? '').trim();
  }
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.replace('::ffff:', '');
  }
  return cleaned;
};

/**
 * Checks whether an IP address belongs to known Cloudflare IPv4 proxy ranges.
 * (Only used when picking client IP from multi-node proxy headers like X-Forwarded-For).
 */
export const isCloudflareProxyIp = (ip: string): boolean => {
  const cleaned = cleanIp(ip).toLowerCase();

  const parts = cleaned.split('.').map(Number);
  if (parts.length !== 4) return false;

  const a = parts[0];
  const b = parts[1];
  const c = parts[2];

  if (a === undefined || b === undefined || c === undefined) return false;
  if (isNaN(a) || isNaN(b) || isNaN(c)) return false;

  // 172.64.0.0 – 172.71.255.255
  if (a === 172 && b >= 64 && b <= 71) return true;
  // 104.16.0.0 – 104.31.255.255
  if (a === 104 && b >= 16 && b <= 31) return true;
  // 162.158.0.0 – 162.159.255.255
  if (a === 162 && (b === 158 || b === 159)) return true;
  // 108.162.192.0 – 108.162.255.255
  if (a === 108 && b === 162 && c >= 192) return true;
  // 198.41.128.0 – 198.41.255.255
  if (a === 198 && b === 41 && c >= 128) return true;
  // 173.245.48.0 – 173.245.63.255
  if (a === 173 && b === 245 && c >= 48 && c <= 63) return true;

  return false;
};

/**
 * Retrieves the REAL end-user client IP address from incoming Express request headers.
 * Prioritizes Cloudflare header `cf-connecting-ip`, followed by `x-forwarded-for` (first non-proxy IP),
 * `x-real-ip`, and finally falls back to `req.ip`.
 */
export const getClientIp = (req: Request): string => {
  // 1. Cloudflare header (highest priority for Cloudflare proxied requests - directly contains client IP)
  const cfIp = req.headers['cf-connecting-ip'] || req.headers['x-client-ip'];
  if (cfIp) {
    const rawIp = Array.isArray(cfIp) ? cfIp[0] : cfIp;
    if (rawIp && typeof rawIp === 'string' && rawIp.trim()) {
      const cleaned = cleanIp(rawIp);
      if (cleaned && cleaned !== '127.0.0.1' && cleaned !== '::1') {
        return cleaned;
      }
    }
  }

  // 2. Standard X-Forwarded-For header
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (rawForwarded && typeof rawForwarded === 'string') {
      const parts = rawForwarded.split(',');
      for (const part of parts) {
        const clientIp = cleanIp(part);
        if (clientIp && !isCloudflareProxyIp(clientIp) && clientIp !== '127.0.0.1' && clientIp !== '::1') {
          return clientIp;
        }
      }
    }
  }

  // 3. X-Real-IP header
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    const rawReal = Array.isArray(realIp) ? realIp[0] : realIp;
    if (rawReal && typeof rawReal === 'string' && rawReal.trim()) {
      const cleaned = cleanIp(rawReal);
      if (cleaned && cleaned !== '127.0.0.1' && cleaned !== '::1') {
        return cleaned;
      }
    }
  }

  // 4. Express req.ip or socket address fallback
  const rawIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  return cleanIp(rawIp);
};
