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
      // Allow multitenant subdomains (e.g. tenantSlug.localhost:3000)
      if (
        origin.endsWith(".localhost:3000") ||
        origin.endsWith(".localhost:3001")
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

// Routes
app.use("/api/v1", tenantMiddleware, routes);

// Health check endpoint
app.get("/ping", (req: Request, res: Response) => {
  res.status(200).json({ message: "pong", time: new Date() });
});

// Not Found Middleware
app.use(notFound);

// Global Error Handler
app.use(globalErrorHandler);

export default app;
