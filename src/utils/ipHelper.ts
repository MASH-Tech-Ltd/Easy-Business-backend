import { Request } from "express";
import net from "node:net";
import os from "node:os";
import { CLOUDFLARE_IPV4_RANGES, CLOUDFLARE_IPV6_RANGES } from "./cloudflareRanges";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CENTRALISED CLIENT IP DETECTION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Request paths this resolves (see deploy/nginx/README.md):
 *
 *   A) Browser → Cloudflare → Nginx → Express
 *        Nginx (real_ip module) verifies the TCP peer is a Cloudflare edge,
 *        restores the visitor IP into X-Real-IP and sets `X-Mash-Edge: cf`.
 *
 *   B) Browser → Cloudflare → Nginx → Next.js BFF → (Cloudflare → Nginx →) Express
 *        The BFF forwards the visitor IP in `x-tenant-client-ip`. Nginx only lets
 *        that header through when the request originates from THIS server
 *        (`X-Mash-Edge: self`) and strips it from everyone else.
 *
 *   C) Next.js BFF → http://127.0.0.1:8000 (no proxy at all)
 *        Loopback peer with no proxy headers ⇒ our own process ⇒ trust
 *        `x-tenant-client-ip`.
 *
 *   D) Browser → Cloudflare → Express (no Nginx)
 *        TCP peer is a Cloudflare edge ⇒ trust CF-Connecting-IP.
 *
 *   E) Anyone → Express directly (origin bypass)
 *        Public non-Cloudflare peer ⇒ every forwarding header is IGNORED and the
 *        un-spoofable TCP peer address is used.
 *
 *  Forwarding headers are only ever read when the immediate TCP peer is trusted.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ClientIpSource =
  | "cloudflare"        // verified: CF edge peer, or hardened Nginx confirmed CF
  | "bff"               // verified: our own Next.js server forwarded the visitor IP
  | "direct-peer"       // verified: TCP peer itself (request bypassed Cloudflare)
  | "internal"          // our own server calling itself with no visitor (SSR, cron, sitemap)
  | "cloudflare-header" // UNVERIFIED: CF-Connecting-IP seen behind a non-hardened proxy
  | "bff-header"        // UNVERIFIED: x-tenant-client-ip seen behind a non-hardened proxy
  | "proxy-header"      // UNVERIFIED: X-Real-IP seen behind a non-hardened proxy
  | "unknown";

export interface ClientIpResult {
  /** Verified visitor public IP, or null when it could not be verified. */
  ip: string | null;
  source: ClientIpSource;
  verified: boolean;
  /** Best-effort, NOT verified value (only set when `verified` is false). */
  candidateIp: string | null;
  /** Immediate TCP peer (Nginx / Cloudflare edge / attacker). Never a visitor IP by itself. */
  peerIp: string | null;
}

// ─── Range tables ────────────────────────────────────────────────────────────

const buildList = (v4: readonly string[], v6: readonly string[]): net.BlockList => {
  const list = new net.BlockList();
  for (const cidr of v4) {
    const [addr, len] = cidr.split("/");
    if (addr && len) list.addSubnet(addr, Number(len), "ipv4");
  }
  for (const cidr of v6) {
    const [addr, len] = cidr.split("/");
    if (addr && len) list.addSubnet(addr, Number(len), "ipv6");
  }
  return list;
};

const CLOUDFLARE_LIST = buildList(CLOUDFLARE_IPV4_RANGES, CLOUDFLARE_IPV6_RANGES);

/** Loopback + private networks a local reverse proxy / Docker bridge / BFF can use. */
const TRUSTED_PEER_LIST = buildList(
  ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  ["::1/128", "fc00::/7"],
);

/** Everything that can never be a visitor's public internet address. */
const NON_PUBLIC_LIST = buildList(
  [
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
    "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16",
    "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
  ],
  ["::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8", "2001:db8::/32", "64:ff9b::/96"],
);

const familyOf = (ip: string): "ipv4" | "ipv6" => (net.isIP(ip) === 6 ? "ipv6" : "ipv4");

// ─── Validation / normalisation ──────────────────────────────────────────────

/**
 * Strictly validates and normalises ONE IP address.
 * Returns null for anything malformed: lists ("a, b"), ports, zone ids, hostnames, junk.
 */
export const normalizeIp = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  let ip = raw.trim();
  if (!ip || ip.length > 64) return null;
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (/^::ffff:/i.test(ip) && net.isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (ip.includes("%")) return null; // IPv6 zone ids are never valid visitor IPs
  const version = net.isIP(ip);
  if (version === 0) return null;
  return version === 6 ? ip.toLowerCase() : ip;
};

export const isCloudflareIp = (ip: string | null | undefined): boolean => {
  const n = normalizeIp(ip);
  return !!n && CLOUDFLARE_LIST.check(n, familyOf(n));
};

export const isPublicIp = (ip: string | null | undefined): boolean => {
  const n = normalizeIp(ip);
  return !!n && !NON_PUBLIC_LIST.check(n, familyOf(n));
};

const isTrustedPeer = (ip: string): boolean => TRUSTED_PEER_LIST.check(ip, familyOf(ip));

// ─── This server's own addresses (to recognise our own BFF traffic) ──────────

let ownIpCache: { ips: Set<string>; at: number } | null = null;
const OWN_IP_TTL = 10 * 60 * 1000;

export const getOwnServerIps = (): Set<string> => {
  if (ownIpCache && Date.now() - ownIpCache.at < OWN_IP_TTL) return ownIpCache.ips;
  const ips = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      const n = normalizeIp(nic.address);
      if (n && isPublicIp(n)) ips.add(n);
    }
  }
  ownIpCache = { ips, at: Date.now() };
  return ips;
};

const isOwnServerIp = (ip: string | null): boolean => !!ip && getOwnServerIps().has(ip);

/** A value that may be stored as a visitor IP: valid, public, not Cloudflare, not us. */
const asVisitorIp = (raw: unknown): string | null => {
  const ip = normalizeIp(raw);
  if (!ip || !isPublicIp(ip) || isCloudflareIp(ip) || isOwnServerIp(ip)) return null;
  return ip;
};

const singleHeader = (req: Request, name: string): string | undefined => {
  const v = req.headers[name];
  if (Array.isArray(v)) return v.length === 1 ? v[0] : undefined; // duplicates ⇒ reject
  return typeof v === "string" ? v : undefined;
};

// ─── Resolver ────────────────────────────────────────────────────────────────

const result = (
  source: ClientIpSource,
  verified: boolean,
  ip: string | null,
  peerIp: string | null,
): ClientIpResult =>
  verified
    ? { ip, source, verified: true, candidateIp: null, peerIp }
    : { ip: null, source, verified: false, candidateIp: ip, peerIp };

const computeClientIp = (req: Request): ClientIpResult => {
  const peer = normalizeIp(req.socket?.remoteAddress);
  if (!peer) return result("unknown", false, null, null);

  // (D) / (E): no local proxy in front of us.
  if (!isTrustedPeer(peer)) {
    if (isCloudflareIp(peer)) {
      const cf = asVisitorIp(singleHeader(req, "cf-connecting-ip"));
      return cf ? result("cloudflare", true, cf, peer) : result("unknown", false, null, peer);
    }
    // Origin bypass: the TCP peer is the only trustworthy fact. Headers are ignored.
    return isPublicIp(peer) && !isOwnServerIp(peer)
      ? result("direct-peer", true, peer, peer)
      : result("unknown", false, null, peer);
  }

  const tenantIp = asVisitorIp(singleHeader(req, "x-tenant-client-ip"));
  const realIpRaw = normalizeIp(singleHeader(req, "x-real-ip"));
  const cfRaw = normalizeIp(singleHeader(req, "cf-connecting-ip"));
  const edge = (singleHeader(req, "x-mash-edge") || "").trim().toLowerCase();

  // (A) / (B) through hardened Nginx — Nginx always overwrites X-Mash-Edge.
  if (edge === "cf" || edge === "self") {
    const fromSelf = edge === "self" || isOwnServerIp(realIpRaw);
    if (fromSelf) {
      return tenantIp ? result("bff", true, tenantIp, peer) : result("internal", false, null, peer);
    }
    const visitor = asVisitorIp(realIpRaw) || asVisitorIp(cfRaw);
    return visitor ? result("cloudflare", true, visitor, peer) : result("unknown", false, null, peer);
  }

  // (C) direct loopback call from our own BFF / SSR (no proxy headers at all).
  const viaProxy = !!(cfRaw || realIpRaw || req.headers["x-forwarded-for"]);
  if (!viaProxy) {
    return tenantIp ? result("bff", true, tenantIp, peer) : result("internal", false, null, peer);
  }

  // Legacy: a local proxy WITHOUT the hardened config. Values are best-effort only.
  if (cfRaw && isOwnServerIp(cfRaw)) {
    // Second Cloudflare hop made by our own BFF (CF-Connecting-IP = this VPS).
    return tenantIp ? result("bff-header", false, tenantIp, peer) : result("internal", false, null, peer);
  }
  const cfVisitor = asVisitorIp(cfRaw);
  if (cfVisitor) return result("cloudflare-header", false, cfVisitor, peer);
  const realVisitor = asVisitorIp(realIpRaw);
  if (realVisitor) return result("proxy-header", false, realVisitor, peer);
  return result("unknown", false, null, peer);
};

/** Resolves (and caches per request) the structured client IP result. */
export const resolveClientIp = (req: Request): ClientIpResult => {
  if (req.clientIpInfo) return req.clientIpInfo;
  const info = computeClientIp(req);
  req.clientIpInfo = info;
  return info;
};

/**
 * String form used by existing modules / Mongo `ipAddress` fields.
 *  - verified visitor IP, else
 *  - best-effort candidate (never a Cloudflare / VPS / private address), else
 *  - "127.0.0.1" for internal server-to-server calls (keeps existing whitelisting), else
 *  - "unknown".
 */
export const getClientIp = (req: Request): string => {
  const info = resolveClientIp(req);
  if (info.ip) return info.ip;
  if (info.candidateIp) return info.candidateIp;
  if (info.source === "internal") return "127.0.0.1";
  return "unknown";
};

/** Rate-limit bucket key: never merges unrelated unknown callers into one shared bucket. */
export const getRateLimitKey = (req: Request): string => {
  const info = resolveClientIp(req);
  return info.ip || info.candidateIp || (info.source === "internal" ? "internal" : `peer:${info.peerIp || "none"}`);
};

/**
 * Whether an IP-based permanent/auto block is allowed for this request.
 * Blocks are only applied to addresses an attacker cannot forge for someone else.
 */
export const canAutoBlockIp = (req: Request): boolean => {
  const info = resolveClientIp(req);
  return (info.verified && !!info.ip) || info.source === "cloudflare-header";
};

// ─── Backward-compatible helpers (used across the codebase) ──────────────────

/** @deprecated use normalizeIp — kept for backward compatibility. */
export const cleanIp = (ip: string): string => {
  if (!ip) return "127.0.0.1";
  const first = (ip.split(",")[0] ?? "").trim();
  return normalizeIp(first) ?? first;
};

/** True for any official Cloudflare edge address (IPv4 + IPv6). */
export const isCloudflareProxyIp = (ip: string): boolean => isCloudflareIp(cleanIp(ip));

/**
 * Loopback / private / Cloudflare edge addresses — these must never be blocked,
 * rate limited or stored as a visitor.
 */
export const isInternalOrWhitelistedIp = (ip: string): boolean => {
  if (!ip) return true;
  const n = normalizeIp(cleanIp(ip));
  if (!n) return ip.trim().toLowerCase() === "localhost";
  return isTrustedPeer(n) || isCloudflareIp(n);
};
