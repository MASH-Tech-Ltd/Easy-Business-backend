import { Request } from "express";

/**
 * Normalizes IPv4 / IPv6 addresses and extracts IPv4 if IPv6-mapped (e.g. ::ffff:192.168.1.1)
 */
export const cleanIp = (ip: string): string => {
  if (!ip) return "127.0.0.1";
  let cleaned = ip.trim();
  if (cleaned.includes(",")) {
    const [first] = cleaned.split(",");
    cleaned = (first ?? "").trim();
  }
  if (cleaned.startsWith("::ffff:")) {
    cleaned = cleaned.replace("::ffff:", "");
  }
  return cleaned;
};

/**
 * Checks whether an IP address belongs to known Cloudflare IPv4 proxy ranges.
 * (Only used when picking client IP from multi-node proxy headers like X-Forwarded-For).
 */
export const isCloudflareProxyIp = (ip: string): boolean => {
  const cleaned = cleanIp(ip).toLowerCase();

  const parts = cleaned.split(".").map(Number);
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
 * Checks whether an IP address belongs to localhost, loopback, private RFC 1918 networks,
 * or known Cloudflare proxy edge nodes.
 * Used to ensure internal server-side rendering (SSR), reverse proxies, and edge proxies are never blocked.
 */
export const isInternalOrWhitelistedIp = (ip: string): boolean => {
  if (!ip) return true;
  const cleaned = cleanIp(ip).toLowerCase();

  if (
    cleaned === "127.0.0.1" ||
    cleaned === "::1" ||
    cleaned === "localhost" ||
    cleaned === "::ffff:127.0.0.1"
  ) {
    return true;
  }

  // Private IPv4 networks (RFC 1918)
  if (cleaned.startsWith("10.") || cleaned.startsWith("192.168.")) {
    return true;
  }
  const parts = cleaned.split(".").map(Number);
  if (parts.length === 4) {
    const a = parts[0];
    const b = parts[1];
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) {
      return true;
    }
  }

  return isCloudflareProxyIp(cleaned);
};

/**
 * Retrieves the REAL verified end-user client IP address from incoming Express request.
 *
 * Priority order:
 *  1. `x-tenant-client-ip` — Custom header set by our internal Next.js SSR server / BFF proxy.
 *     (Next.js extracts authentic visitor IP from browser and passes it on SSR calls).
 *  2. `cf-connecting-ip` / `req.realUserIp` — Cloudflare's verified edge header (direct browser to CF).
 *  3. `x-real-ip` — Nginx reverse proxy fallback.
 *  4. `x-forwarded-for` — Standard proxy chain fallback.
 *  5. `req.ip` / socket address — Last resort.
 */
export const getClientIp = (req: Request): string => {
  // 1. Custom SSR-forwarded header (Next.js SSR → Backend path)
  const tenantClientIp = req.headers["x-tenant-client-ip"];
  if (tenantClientIp) {
    const rawIp = Array.isArray(tenantClientIp)
      ? tenantClientIp[0]
      : tenantClientIp;
    if (rawIp && typeof rawIp === "string" && rawIp.trim()) {
      const cleaned = cleanIp(rawIp);
      if (cleaned && !isInternalOrWhitelistedIp(cleaned)) {
        return cleaned;
      }
    }
  }

  // 2. Cloudflare verified header (Direct browser → CF → Backend)
  const cfIp = req.realUserIp || req.headers["cf-connecting-ip"] || req.headers["x-client-ip"];
  if (cfIp) {
    const rawIp = Array.isArray(cfIp) ? cfIp[0] : cfIp;
    if (rawIp && typeof rawIp === "string" && rawIp.trim()) {
      const cleaned = cleanIp(rawIp);
      if (cleaned && !isCloudflareProxyIp(cleaned) && cleaned !== "127.0.0.1" && cleaned !== "::1") {
        return cleaned;
      }
    }
  }

  // 3. X-Real-IP header (trusted Nginx loopback proxy)
  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    const rawReal = Array.isArray(realIp) ? realIp[0] : realIp;
    if (rawReal && typeof rawReal === "string" && rawReal.trim()) {
      const cleaned = cleanIp(rawReal);
      if (cleaned && !isCloudflareProxyIp(cleaned) && cleaned !== "127.0.0.1" && cleaned !== "::1") {
        return cleaned;
      }
    }
  }

  // 4. X-Forwarded-For header (fallback for non-Cloudflare proxies)
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (rawForwarded && typeof rawForwarded === "string" && rawForwarded.trim()) {
      const cleaned = cleanIp(rawForwarded);
      if (cleaned && !isCloudflareProxyIp(cleaned) && cleaned !== "127.0.0.1" && cleaned !== "::1") {
        return cleaned;
      }
    }
  }

  // 5. Express req.ip (now trusted via loopback proxy) or socket remoteAddress
  const rawIp = req.ip || req.socket?.remoteAddress || "127.0.0.1";
  return cleanIp(rawIp);
};
