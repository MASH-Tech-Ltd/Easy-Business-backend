import { Request, Response, NextFunction } from "express";
import { Tenant } from "../modules/tenant/tenant.model";
import ApiResponse from "../utils/apiResponse";
import config from "../config";

export const tenantMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    let rawHost =
      (req.headers["x-forwarded-host"] as string) ||
      req.headers.host ||
      req.hostname ||
      "";
    const host = rawHost.split(":")[0] || "";

    // Example: "abcstore.myplatform.com"
    // Extract subdomain
    let isCustomDomain = false;
    let slugOrDomain = "";

    // Exclude the main frontend and allowed origin domains from tenant checks
    const allowedUrls = [
      config.app.frontendUrl,
      ...(config.app.allowedOrigins || []),
    ];

    const excludedDomains = allowedUrls.map((url) => {
      try {
        return new URL(url).host;
      } catch (e) {
        return url;
      }
    });
    excludedDomains.push("localhost", "127.0.0.1");

    // If the host is in our allowed origins OR is the base domain itself, bypass tenant lookup
    if (
      excludedDomains.includes(host) ||
      host === config.app.baseDomain ||
      host === `backapi.${config.app.baseDomain}`
    ) {
      return next();
    }

    const baseDomain = config.app.baseDomain || "localhost"; // fallback for local

    if (host.includes(baseDomain) && host !== baseDomain) {
      // It's a subdomain
      slugOrDomain = host.split(".")[0] || "";
    } else if (host !== baseDomain) {
      // It's a custom domain
      isCustomDomain = true;
      slugOrDomain = host;
    }

    if (!slugOrDomain) {
      // No tenant domain/subdomain identified, probably main site
      return next();
    }

    // Convert to lowercase to prevent 'Astha' vs 'astha' mismatch
    slugOrDomain = slugOrDomain.toLowerCase();

    // // Strip "www." if it exists
    // if (slugOrDomain.startsWith('www.')) {
    //   slugOrDomain = slugOrDomain.replace(/^www\./, '');
    // }
    // Verification Log as requested
    if (process.env.NODE_ENV === "development") {
      console.log("=== BACKEND TENANT PARSING VERIFICATION ===");
      console.log("Original Host:", rawHost);
      console.log("Parsed Host:", host);
      console.log("Is Custom Domain:", isCustomDomain);
      console.log("Database Lookup Key (slug/domain):", slugOrDomain);
      console.log("===========================================");
    }

    const bare = slugOrDomain.replace(/^www\./, '');
    const withWww = `www.${bare}`;

    let tenant;
    if (isCustomDomain) {
      tenant = await Tenant.findOne({
        $or: [
          { customDomain: bare },
          { customDomain: withWww }
        ],
        status: "active",
      });
    } else {
      tenant = await Tenant.findOne({ slug: bare, status: "active" });
    }

    if (!tenant) {
      console.log(
        `[TenantMiddleware] Store not found for slug/domain: ${slugOrDomain}`,
      );
      return ApiResponse.sendError(res, 404, "Store not found or suspended");
    }

    // Attach tenant info to request
    (req as any).tenantId = tenant._id;
    (req as any).tenant = tenant;

    next();
  } catch (error) {
    next(error);
  }
};
