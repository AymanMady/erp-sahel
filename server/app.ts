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
import { ensureSuperAdmin } from "./domains/system/super-admin";
import { registerRoutes } from "./routes";
import { intlLocale, localeMiddleware } from "./shared/i18n";
import { setFormatLocaleResolver } from "@shared/intl";
import { logger } from "./shared/logging/logger";

/**
 * Document dates ("today", fiscal year of a number) must not depend on where the server
 * runs. Mauritania is on UTC all year round, without summer time.
 */
process.env.TZ = process.env.APP_TIMEZONE ?? "UTC";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

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

  // Request bodies are read in `registerRoutes`, after rate limiting.
  app.use(compression());

  /** Correlation id propagated in logs and error responses. */
  app.use((req, res, next) => {
    // Written as-is in the logs and echoed back: only a short, plain value is kept.
    const supplied = req.headers["x-request-id"];
    req.requestId =
      typeof supplied === "string" && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
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

  // Housekeeping, not awaited: on a cold start (serverless instance, database waking
  // up) the first requests — the health probe first of all — must not wait for it.
  void authRepository
    .purgeExpiredTokens()
    .then((purged) => {
      if (purged > 0) logger.info("Expired sessions purged", { count: purged });
    })
    .catch((error: unknown) => {
      logger.warn("Expired sessions purge failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });

  // The super-administrator account is (re)created from the configuration, so that it
  // can always sign in. Tests create their own accounts.
  if (process.env.NODE_ENV !== "test") void ensureSuperAdmin();

  registerRoutes(app);

  return app;
}
