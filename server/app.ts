/**
 * Builds the Express application, without starting HTTP.
 *
 * Shared by the regular server (`index.ts`, which adds the client and then listens on a
 * port) and by the Vercel serverless function (`vercel.ts`, which only serves `/api`).
 */

import { randomUUID } from "node:crypto";

import compression from "compression";
import express, { type Express } from "express";

import { assertTokenConfiguration } from "./domains/auth/tokens";
import { authRepository } from "./domains/auth/repository";
import { registerRoutes } from "./routes";
import { intlLocale, localeMiddleware } from "./shared/i18n";
import { setFormatLocaleResolver } from "@shared/intl";
import { logger } from "./shared/logging/logger";

/**
 * Validates the configuration and registers the API routes.
 * The client (Vite or static) is left to the caller.
 */
export async function createApp(): Promise<Express> {
  assertTokenConfiguration();
  // Shared formatters (money, dates) follow the locale of the request being served.
  setFormatLocaleResolver(() => intlLocale());

  const app = express();

  // Behind a proxy (host, Vercel): the real IP is used for rate limiting.
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

  // Request locale (Accept-Language) for translated messages and exports. Mounted
  // first so that body-parsing errors are translated too.
  app.use(localeMiddleware);

  // 10 MB: a company logo as a data URI fits, a large file import does not
  // (such imports will go through a dedicated upload, not the JSON body).
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
  app.use(compression());

  /** Correlation id propagated in logs and error responses. */
  app.use((req, res, next) => {
    req.requestId = String(req.headers["x-request-id"] ?? randomUUID());
    res.setHeader("x-request-id", req.requestId);
    next();
  });

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
        requestId: req.requestId,
        durationMs: duration,
      });
    });
    next();
  });

  const purged = await authRepository.purgeExpiredTokens();
  if (purged > 0) logger.info("Expired sessions purged", { count: purged });

  registerRoutes(app);

  return app;
}
