import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import routes from "./routes/index";
import { globalErrorHandler } from "./helpers/globalErrorHandler";
import { notFound } from "./middleware/notFound";
import { tenantMiddleware } from "./middleware/tenant.middleware";
// import { globalRateLimiter } from "./middleware/rateLimiter";
import config from "./config/index";
import { Tenant } from "./modules/tenant/tenant.model";

const app: Application = express();
app.set("trust proxy", 1);

import { ipBlocklistMiddleware, attackDetectionMiddleware } from './middleware/security.middleware';
// Apply IP blocklist and attack detection before processing anything else
app.use(ipBlocklistMiddleware);
app.use(express.json({ limit: "5mb" })); // Need body parser for attack detection
app.use(attackDetectionMiddleware);

// SECURITY FIX: Strict CORS allow-list — never trust unknown origins
const allowedOrigins = [
  config.app.frontendUrl,
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:5173",
  "http://localhost:5174",
  ...config.app.allowedOrigins,
];

app.use(
  cors({
    origin: async (origin, callback) => {
      // Allow server-to-server requests (no Origin header) for Next.js proxy
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Allow multitenant subdomains and all production subdomains
      if (
        origin.endsWith(".localhost:3000") ||
        origin.endsWith(".localhost:3001") ||
        origin.endsWith(".masheco.com") ||
        origin === "https://masheco.com"
      ) {
        return callback(null, true);
      }

      try {
        // Handle custom domains dynamically
        // Remove protocol for DB lookup if stored without it
        const host = new URL(origin).host;
        const tenant = await Tenant.findOne({
          $or: [{ domain: host }, { customDomain: host }],
        });

        if (tenant) {
          return callback(null, true);
        }
      } catch (err) {
        return callback(new Error("CORS: Error checking custom domain"), false);
      }

      return callback(new Error(`CORS: Origin '${origin}' not allowed`), false);
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(helmet());
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(morgan(config.app.env === "development" ? "dev" : "short"));
// app.use(globalRateLimiter);

// Development environment hostname logger
if (config.app.env === "development") {
  app.use((req: Request, res: Response, next) => {
    console.log(`[DEV] Incoming Hostname: ${req.hostname}`);
    next();
  });
}

// Routes
app.use("/api/v1", tenantMiddleware, routes);

// Cloudflare Custom Hostname Ownership HTTP Validation
app.get("/.well-known/cf-custom-hostname-challenge/:uuid", async (req: Request, res: Response) => {
  const uuid = req.params.uuid;

  if (!uuid || typeof uuid !== 'string') {
    return res.status(400).send("UUID is missing or invalid");
  }

  try {
    const safeUuid = uuid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tenants = await Tenant.find({
      "sslValidationRecords.http_url": { $regex: safeUuid }
    });

    for (const tenant of tenants) {
      const record = tenant.sslValidationRecords?.find(
        (r: any) => r.http_url && r.http_url.includes(uuid)
      );
      if (record && record.http_body) {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(record.http_body);
      }
    }

    res.status(404).send("UUID not found");
  } catch (error) {
    console.error("CF custom hostname challenge error:", error);
    res.status(500).send("Internal server error");
  }
});

// Cloudflare HTTP Validation (ACME Challenge) endpoint
app.get("/.well-known/acme-challenge/:token", async (req: Request, res: Response) => {
  const token = req.params.token;

  if (!token || typeof token !== 'string') {
    return res.status(400).send("Token is missing or invalid");
  }

  try {
    // Dynamic Search across all tenants for a matching token in the sslValidationRecords
    const safeToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tenants = await Tenant.find({
      "sslValidationRecords.http_url": { $regex: safeToken }
    });

    for (const tenant of tenants) {
      const record = tenant.sslValidationRecords?.find(
        (r: any) => r.http_url && r.http_url.includes(token)
      );
      if (record && record.http_body) {
        // Must return plain text
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(record.http_body);
      }
    }

    res.status(404).send("Token not found");
  } catch (error) {
    console.error("ACME challenge error:", error);
    res.status(500).send("Internal server error");
  }
});

// Health check endpoint
app.get("/ping", (req: Request, res: Response) => {
  res.status(200).json({ message: "pong", time: new Date() });
});

// Not Found Middleware
app.use(notFound);

// Global Error Handler
app.use(globalErrorHandler);

export default app;
