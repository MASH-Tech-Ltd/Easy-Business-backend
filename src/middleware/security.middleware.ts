import { Request, Response, NextFunction } from "express";
import { BlockedIp, SecurityLog } from "../modules/system/security.model";
import {
  getClientIp,
  isCloudflareProxyIp,
  isInternalOrWhitelistedIp,
} from "../utils/ipHelper";
import config from "../config/index";

// ──────────────────────────────────────────────────────────────────────────────
// Blocked IPs Cache  (rebuilt from DB every 60s; bounded by DB size)
// ──────────────────────────────────────────────────────────────────────────────
let blockedIpsCache: Set<string> = new Set();
let lastCacheUpdate = 0;
const BLOCKED_IP_CACHE_TTL = 60 * 1000; // 1 minute

export const refreshBlockedIpsCache = async () => {
  try {
    const blocked = await BlockedIp.find({
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ],
    }).select("ipAddress");

    // Exclude any internal, loopback, or Cloudflare proxy edge IPs from the active block cache
    const validBlockedIps = blocked
      .map((b) => b.ipAddress)
      .filter((ip) => !isInternalOrWhitelistedIp(ip));

    blockedIpsCache = new Set(validBlockedIps); // Full replacement — always bounded by DB
    lastCacheUpdate = Date.now();
  } catch (error) {
    console.error("Failed to refresh Blocked IPs cache:", error);
  }
};

export const unblockIpFromCache = (ip: string) => {
  blockedIpsCache.delete(ip);
};

export const ipBlocklistMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Always bypass blocklist for internal Socket.IO polling & websocket handshakes
  if (req.originalUrl.startsWith("/socket.io")) {
    return next();
  }

  const ip = getClientIp(req);

  // Never block internal, loopback, or Cloudflare proxy edge node IPs directly
  if (isInternalOrWhitelistedIp(ip)) {
    return next();
  }

  // Refresh cache if stale (non-blocking — awaited here intentionally for correctness)
  if (Date.now() - lastCacheUpdate > BLOCKED_IP_CACHE_TTL) {
    await refreshBlockedIpsCache();
  }

  if (blockedIpsCache.has(ip)) {
    return res.status(403).json({
      success: false,
      message:
        "Your IP address has been blocked due to suspicious activity or policy violations.",
    });
  }

  next();
};

// ──────────────────────────────────────────────────────────────────────────────
// Direct CLI / Automation / Curl Detection & Immediate Blocking
// ──────────────────────────────────────────────────────────────────────────────
const FORBIDDEN_CLIENT_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  // CLI HTTP clients
  { regex: /^curl\b/i, name: "cURL" },
  { regex: /\bcurl\/\d/i, name: "cURL" },
  { regex: /\blibcurl\b/i, name: "libcurl" },
  { regex: /^wget\b/i, name: "Wget" },
  { regex: /\bhttpie\b/i, name: "HTTPie" },
  { regex: /\baria2\b/i, name: "aria2" },

  // API Development & Testing Tools
  { regex: /\bpostmanruntime\b/i, name: "Postman" },
  { regex: /\bpostman\b/i, name: "Postman" },
  { regex: /\binsomnia\b/i, name: "Insomnia" },
  { regex: /\bthunder[- ]?client\b/i, name: "Thunder Client" },
  { regex: /\bsoapui\b/i, name: "SoapUI" },
  { regex: /\bpaw\/\d/i, name: "Paw" },
  { regex: /\brest-client\b/i, name: "REST Client" },

  // Programming language HTTP libraries & scripts
  { regex: /\bpython-requests\b/i, name: "Python Requests" },
  { regex: /\bpython-urllib\b/i, name: "Python Urllib" },
  { regex: /\burllib3\b/i, name: "Urllib3" },
  { regex: /\baiohttp\b/i, name: "aiohttp" },
  { regex: /\bhttpx\b/i, name: "HTTPX" },
  { regex: /\bgo-http-client\b/i, name: "Go HTTP Client" },
  { regex: /\bapache-httpclient\b/i, name: "Apache HttpClient" },
  { regex: /\bokhttp\b/i, name: "OkHttp" },
  { regex: /\bjava\/\d/i, name: "Java HTTP Client" },
  { regex: /\bjersey\/\d/i, name: "Jersey" },
  { regex: /\blibwww-perl\b/i, name: "Perl libwww" },
  { regex: /\blwp-trivial\b/i, name: "Perl LWP" },
  { regex: /\bguzzlehttp\b/i, name: "Guzzle (PHP)" },
  { regex: /\bphp\/\d/i, name: "PHP HTTP Client" },
  { regex: /\bfaraday\b/i, name: "Ruby Faraday" },
  { regex: /\bhttparty\b/i, name: "Ruby HTTParty" },
  { regex: /\bnode-fetch\b/i, name: "node-fetch" },
  { regex: /\baxios\/\d/i, name: "Axios direct script" },

  // Scrapers & Headless Automation
  { regex: /\bscrapy\b/i, name: "Scrapy" },
  { regex: /\bmechanize\b/i, name: "Mechanize" },
  { regex: /\bphantomjs\b/i, name: "PhantomJS" },
  { regex: /\bcasperjs\b/i, name: "CasperJS" },
  { regex: /\bpuppeteer\b/i, name: "Puppeteer" },
  { regex: /\bplaywright\b/i, name: "Playwright" },
  { regex: /\bselenium\b/i, name: "Selenium" },
  { regex: /\bwebdriver\b/i, name: "WebDriver" },
  { regex: /\bheadlesschrome\b/i, name: "Headless Chrome" },

  // Vulnerability scanners & Exploitation tools
  { regex: /\bnikto\b/i, name: "Nikto" },
  { regex: /\bsqlmap\b/i, name: "SQLMap" },
  { regex: /\bnmap\b/i, name: "Nmap" },
  { regex: /\bmasscan\b/i, name: "Masscan" },
  { regex: /\bwpscan\b/i, name: "WPScan" },
  { regex: /\bdirbuster\b/i, name: "DirBuster" },
  { regex: /\bgobuster\b/i, name: "Gobuster" },
  { regex: /\bacunetix\b/i, name: "Acunetix" },
  { regex: /\bopenvas\b/i, name: "OpenVAS" },
  { regex: /\bnessus\b/i, name: "Nessus" },
  { regex: /\bzgrab\b/i, name: "Zgrab" },
  { regex: /\bcensys\b/i, name: "Censys" },
  { regex: /\bshodan\b/i, name: "Shodan" },
  { regex: /\bburpcollaborator\b/i, name: "Burp Collaborator" },
];

export const isForbiddenDirectClient = (
  userAgent?: string,
): { isForbidden: boolean; toolName?: string; reason?: string } => {
  const trimmed = (userAgent || "").trim();

  // Missing or empty/dummy User-Agent
  if (
    !trimmed ||
    trimmed === "-" ||
    /^([-\s]|null|undefined|none|test)$/i.test(trimmed)
  ) {
    return {
      isForbidden: true,
      toolName: "Missing/Empty User-Agent",
      reason: "Missing or empty User-Agent header (direct CLI/script request)",
    };
  }

  for (const item of FORBIDDEN_CLIENT_PATTERNS) {
    if (item.regex.test(trimmed)) {
      return {
        isForbidden: true,
        toolName: item.name,
        reason: `Forbidden direct client detected: ${item.name} ("${trimmed}")`,
      };
    }
  }

  return { isForbidden: false };
};

/**
 * Middleware that strictly forbids direct requests from curl, API tools, scrapers,
 * and clients with missing user-agents in production mode.
 * Any detected violation results in an immediate and permanent IP block.
 */
export const directClientBlockMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const isProduction =
    config.app.env === "production" || process.env.NODE_ENV === "production";
  const forceBlock = process.env.BLOCK_DIRECT_CLIENTS === "true";

  // Strictly enforce in production mode (or when explicitly forced via env for testing)
  if (!isProduction && !forceBlock) {
    return next();
  }

  // Exempt internal Socket.IO polling & websocket handshakes
  if (req.originalUrl.startsWith("/socket.io")) {
    return next();
  }

  // Exempt Cloudflare custom hostname validation & ACME challenges
  if (req.originalUrl.startsWith("/.well-known/")) {
    return next();
  }

  // Exempt server health check
  if (req.path === "/ping" || req.originalUrl === "/ping") {
    return next();
  }

  const ip = getClientIp(req);

  // Never block loopback, internal VPS, or Cloudflare proxy edge node IPs directly
  if (isInternalOrWhitelistedIp(ip)) {
    return next();
  }

  // Allow verified internal SSR / server-to-server requests using STOREFRONT_API_KEY
  const storefrontApiKey = req.headers["x-storefront-api-key"];
  const validApiKey =
    process.env.STOREFRONT_API_KEY || config.storefront.apiKey;
  if (validApiKey && storefrontApiKey === validApiKey) {
    return next();
  }

  // Allow requests forwarded from internal Next.js with tenant client IP
  if (req.headers["x-tenant-client-ip"]) {
    return next();
  }

  // Allow authenticated requests (merchants/admins with JWT token)
  if (req.headers.authorization) {
    return next();
  }

  const rawUserAgent = req.headers["user-agent"];
  const userAgent = typeof rawUserAgent === "string" ? rawUserAgent : "";

  // Allow legitimate search engine bots (Googlebot, Bingbot, etc.)
  if (isLegitimateSearchBot(userAgent)) {
    return next();
  }

  const directClientCheck = isForbiddenDirectClient(userAgent);
  if (directClientCheck.isForbidden) {
    // Only permanently ban actual vulnerability scanners & automated exploit tools
    const isVulnerabilityScanner =
      /nikto|sqlmap|nmap|masscan|wpscan|dirbuster|gobuster|acunetix|openvas|nessus|zgrab|censys|shodan|burpcollaborator/i.test(
        userAgent,
      );

    if (isVulnerabilityScanner && !isInternalOrWhitelistedIp(ip)) {
      try {
        const requestedFrom = getRequestedFrom(req);
        const incidentReason = `Automated vulnerability scanner blocked in production: ${directClientCheck.toolName}`;
        const blockReason = `[AUTO-BLOCKED] Scanner ${directClientCheck.toolName} in production`;

        // 1. Log the security incident
        await SecurityLog.create({
          incidentType: "DIRECT_TOOL_BLOCKED",
          endpoint: req.originalUrl,
          ipAddress: ip,
          reason: incidentReason,
          requestedFrom,
          userAgent: userAgent || "Missing User-Agent",
        }).catch((logErr) => {
          console.warn(
            "[SECURITY] Failed to log direct tool incident:",
            logErr?.message,
          );
        });

        // 2. Immediate IP block in database
        await BlockedIp.findOneAndUpdate(
          { ipAddress: ip },
          {
            $set: {
              ipAddress: ip,
              reason: blockReason,
              type: "auto",
              userAgent: userAgent || "Missing User-Agent",
              blockedAt: new Date(),
            },
          },
          { upsert: true, returnDocument: "after" },
        ).catch((dbErr) => {
          console.error(
            `[SECURITY] Failed to save blocked IP ${ip}:`,
            dbErr?.message,
          );
        });

        // 3. Immediately update in-memory cache to block all subsequent requests instantly
        blockedIpsCache.add(ip);

        console.warn(
          `[SECURITY] Immediate IP Block: IP ${ip} blocked permanently due to ${directClientCheck.toolName} in production`,
        );

        return res.status(403).json({
          success: false,
          message:
            "Access denied: Vulnerability scanners are strictly prohibited. Your IP address has been permanently blocked.",
        });
      } catch (err) {
        console.error("[SECURITY] Error during direct client IP block:", err);
      }
    }

    // For generic tools / missing user agents: reject the request without permanently banning the IP
    return res.status(403).json({
      success: false,
      message: "Access denied: Direct script/tool requests are prohibited.",
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
const WARNING_TTL = 60 * 60 * 1000; // 1-hour rolling window per IP
const WARNING_CACHE_MAX_SIZE = 2000; // safety cap — ~40 bytes each = ~80 KB max

interface WarningEntry {
  timestamp: number;
  expiresAt: number;
}
const warningCache = new Map<string, WarningEntry>();

// Evict expired entries every 30 minutes — .unref() so it never blocks graceful shutdown
setInterval(
  () => {
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
  },
  30 * 60 * 1000,
).unref();

// Helper to check if a User-Agent belongs to a legitimate search engine or social media crawler
export const isLegitimateSearchBot = (userAgent?: string): boolean => {
  if (!userAgent) return false;
  return /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|facebookexternalhit|twitterbot|linkedinbot|pinterestbot|applebot|whatsapp|telegram/i.test(
    userAgent,
  );
};

// Helper to determine exact source app based on Origin/Referer
export const getRequestedFrom = (req: Request): string => {
  const origin = req.headers.origin || req.headers.referer || "";
  if (origin.includes("3000") || origin.includes("3001"))
    return "Merchant Dashboard";
  if (
    origin.includes("5173") ||
    origin.includes("5174") ||
    origin.includes("admin")
  )
    return "Super Admin Dashboard";
  if (
    origin.includes("3002") ||
    origin.includes("localhost") ||
    origin.includes(".")
  )
    return "Web Store";
  return "Mobile App / Unknown";
};

export const attackDetectionMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const ip = getClientIp(req);
  const userAgent = (req.headers["user-agent"] as string) || "";

  // Never evaluate or block internal VPS, loopback, or Cloudflare proxy node IPs or internal Socket.IO polling
  if (
    isInternalOrWhitelistedIp(ip) ||
    req.originalUrl.startsWith("/socket.io")
  ) {
    return next();
  }

  const payloadStr =
    JSON.stringify(req.body || {}) +
    JSON.stringify(req.query || {}) +
    req.originalUrl;

  // Basic heuristic for malicious payload (XSS tags, inline JS)
  const isSuspicious = /(<script>|<\/script>|javascript:)/i.test(payloadStr);

  // Detect bot probes targeting PHP / ASP / WordPress / exploit files in requested URL path
  const isPhpBotProbe =
    /(\.(php|asp|aspx|jsp)($|\?)|wp-admin|wp-login|wp-content|xmlrpc|phpinfo|phpunit|setup-config|eval-stdin)/i.test(
      req.path,
    );

  // Critical files and path traversal attempts → immediate 1-strike ban
  // Note: /etc/passwd and /etc/shadow use exact path checks so product names, slugs, and search queries containing "shadow" (e.g. "Sense 2 Shadow Grey") are never falsely blocked.
  const isCriticalAttack =
    isPhpBotProbe ||
    /(\.env($|\?)|config\.json|\/etc\/passwd|\/etc\/shadow|\.\.\/|\.\.\\|%2e%2e)/i.test(
      payloadStr,
    );

  // Allow legitimate search engine bots (Googlebot, Bingbot, etc.) to index public pages,
  // provided the request does NOT contain explicit critical attack payloads.
  if (isLegitimateSearchBot(userAgent) && !isCriticalAttack && !isSuspicious) {
    return next();
  }

  if (isCriticalAttack || isSuspicious) {
    try {
      const requestedFrom = getRequestedFrom(req);

      await SecurityLog.create({
        incidentType: "ATTACK_DETECTED",
        endpoint: req.originalUrl,
        ipAddress: ip,
        reason: isPhpBotProbe
          ? "Immediate Block: Automated PHP/WordPress bot exploit probe"
          : isCriticalAttack
            ? "Immediate Block: Attempted to access sensitive system files or path traversal"
            : "Suspicious payload matching known XSS/NoSQLi signatures",
        requestedFrom,
        userAgent: req.headers["user-agent"] || "Unknown",
      });

      const now = Date.now();
      const existing = warningCache.get(ip);
      // A warning is "valid" if it was set and hasn't expired yet
      const hasValidWarning = existing && now < existing.expiresAt;

      // Critical attack → immediate block; otherwise two-strike rule
      if (
        (isCriticalAttack || hasValidWarning) &&
        !isInternalOrWhitelistedIp(ip)
      ) {
        await BlockedIp.findOneAndUpdate(
          { ipAddress: ip },
          {
            $set: {
              ipAddress: ip,
              reason: isCriticalAttack
                ? "[AUTO-BLOCKED] Critical Attack: File Traversal / System File Access"
                : "[AUTO-BLOCKED] Repeated Malicious Activity (2 strikes)",
              type: "auto",
              userAgent: req.headers["user-agent"] || "Unknown",
              blockedAt: new Date(),
            },
          },
          { upsert: true, returnDocument: "after" },
        );
        blockedIpsCache.add(ip);
        warningCache.delete(ip); // Free memory immediately after block
        return res
          .status(403)
          .json({
            success: false,
            message:
              "IP address permanently blocked due to malicious activity.",
          });
      } else {
        // Record first strike with its own TTL
        warningCache.set(ip, { timestamp: now, expiresAt: now + WARNING_TTL });
        return res
          .status(403)
          .json({
            success: false,
            message:
              "Malicious payload detected. This incident has been logged. Further attempts will result in an IP ban.",
          });
      }
    } catch (_err) {
      // Absorb silently — never let security middleware crash the request pipeline
    }
  }

  next();
};
