import { Request } from 'express';

/**
 * Normalizes IPv4 / IPv6 addresses and extracts IPv4 if IPv6-mapped (e.g. ::ffff:192.168.1.1)
 */
export const cleanIp = (ip: string): string => {
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
 * Checks if an IP address is a Cloudflare Pseudo IPv4 (dummy IPv4) address.
 * When Cloudflare's "Pseudo IPv4" setting is enabled, IPv6 client addresses are converted
 * into synthetic Class E (240.0.0.0/4) or CGNAT (100.64.0.0/10) IPv4 addresses.
 * These synthetic addresses are invalid for IP geolocation lookups (e.g. ip-api.com returns reserved range).
 */
export const isPseudoIpv4 = (ip: string): boolean => {
  if (!ip) return false;
  const cleaned = cleanIp(ip);
  const parts = cleaned.split('.').map(Number);
  if (parts.length !== 4) return false;
  const a = parts[0];
  const b = parts[1];

  if (a === undefined || b === undefined || isNaN(a) || isNaN(b)) return false;

  // Class E experimental range (240.0.0.0 – 255.255.255.255)
  if (a >= 240 && a <= 255) return true;

  // Carrier-Grade NAT (CGNAT) range (100.64.0.0 – 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
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
 * Bypasses Cloudflare's synthetic Pseudo IPv4 (dummy IPv4) addresses if present,
 * preferring the visitor's real IPv6 (from cf-connecting-ipv6) or real IPv4.
 */
export const getClientIp = (req: Request): string => {
  // 1. Cloudflare explicit real IPv6 header (sent when Pseudo IPv4 is enabled)
  const cfIpv6 = req.headers['cf-connecting-ipv6'];
  if (cfIpv6) {
    const rawIp = Array.isArray(cfIpv6) ? cfIpv6[0] : cfIpv6;
    if (rawIp && typeof rawIp === 'string' && rawIp.trim()) {
      const cleaned = cleanIp(rawIp);
      if (cleaned && cleaned !== '127.0.0.1' && cleaned !== '::1') {
        return cleaned;
      }
    }
  }

  // 2. Custom SSR-forwarded header (Next.js → CF → Backend path)
  const tenantClientIp = req.headers['x-tenant-client-ip'];
  if (tenantClientIp) {
    const rawIp = Array.isArray(tenantClientIp) ? tenantClientIp[0] : tenantClientIp;
    if (rawIp && typeof rawIp === 'string' && rawIp.trim()) {
      const cleaned = cleanIp(rawIp);
      if (cleaned && cleaned !== '127.0.0.1' && cleaned !== '::1' && !isPseudoIpv4(cleaned)) {
        return cleaned;
      }
    }
  }

  // 3. Standard X-Forwarded-For header (first non-proxy, non-pseudo IP)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (rawForwarded && typeof rawForwarded === 'string') {
      const parts = rawForwarded.split(',');
      for (const part of parts) {
        const clientIp = cleanIp(part);
        if (
          clientIp &&
          !isCloudflareProxyIp(clientIp) &&
          !isPseudoIpv4(clientIp) &&
          clientIp !== '127.0.0.1' &&
          clientIp !== '::1'
        ) {
          return clientIp;
        }
      }
    }
  }

  // 4. Cloudflare cf-connecting-ip header
  const cfIp = req.headers['cf-connecting-ip'] || req.headers['x-client-ip'];
  if (cfIp) {
    const rawIp = Array.isArray(cfIp) ? cfIp[0] : cfIp;
    if (rawIp && typeof rawIp === 'string' && rawIp.trim()) {
      const cleaned = cleanIp(rawIp);
      if (cleaned && cleaned !== '127.0.0.1' && cleaned !== '::1' && !isPseudoIpv4(cleaned)) {
        return cleaned;
      }
    }
  }

  // 5. X-Real-IP header
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    const rawReal = Array.isArray(realIp) ? realIp[0] : realIp;
    if (rawReal && typeof rawReal === 'string' && rawReal.trim()) {
      const cleaned = cleanIp(rawReal);
      if (cleaned && cleaned !== '127.0.0.1' && cleaned !== '::1' && !isPseudoIpv4(cleaned)) {
        return cleaned;
      }
    }
  }

  // Fallback: If only pseudo IPv4 or tenantClientIp exists, use tenantClientIp or cfIp
  if (tenantClientIp) {
    const rawIp = Array.isArray(tenantClientIp) ? tenantClientIp[0] : tenantClientIp;
    if (rawIp && typeof rawIp === 'string' && rawIp.trim()) return cleanIp(rawIp);
  }
  if (cfIp) {
    const rawIp = Array.isArray(cfIp) ? cfIp[0] : cfIp;
    if (rawIp && typeof rawIp === 'string' && rawIp.trim()) return cleanIp(rawIp);
  }

  // 6. Express req.ip or socket address fallback
  const rawIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  return cleanIp(rawIp);
};
