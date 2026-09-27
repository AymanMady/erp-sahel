/**
 * Composition root of the HTTP routes.
 *
 * Deliberate order: security → health → client version → rate limiting → core domains →
 * modules → API 404 → error handler. The error handler must remain **the last** mounted
 * middleware, otherwise exceptions from later routes would escape it.
 */

import express, { type Express, type NextFunction, type Request, type Response } from "express";

import { apiRateLimit } from "./middleware/rate-limit";
import { idempotency } from "./middleware/idempotency";
import { apiNotFound, errorHandler } from "./middleware/error-handler";
import { clientVersionGate } from "./middleware/client-version";
import { corsMiddleware, securityHeaders } from "./middleware/security";
import { pool } from "./db";
import { registerAccountingRoutes } from "./domains/accounting/routes";
import { registerAuthRoutes } from "./domains/auth/routes";
import { registerBankingRoutes } from "./domains/banking/routes";
import { registerCatalogRoutes } from "./domains/catalog/routes";
import { registerDesktopRoutes } from "./domains/desktop/routes";
import { registerInventoryRoutes } from "./domains/inventory/routes";
import { registerInvoicingRoutes } from "./domains/invoicing/routes";
import { registerPartiesRoutes } from "./domains/parties/routes";
import { registerPaymentsRoutes } from "./domains/payments/routes";
import { featureGate } from "./domains/plugins/features";
import { registerPluginsRoutes } from "./domains/plugins/routes";
import { registerPosRoutes } from "./domains/pos/routes";
import { registerPurchasingRoutes } from "./domains/purchasing/routes";
import { registerReportsRoutes } from "./domains/reports/routes";
import { registerSalesRoutes } from "./domains/sales/routes";
import { registerServicesRoutes } from "./domains/services/routes";
import { registerSyncRoutes } from "./domains/sync/routes";
import { registerSystemRoutes } from "./domains/system/routes";
import { registerTenancyRoutes } from "./domains/tenancy/routes";
import { registerUsersRoutes } from "./domains/users/routes";

/**
 * Request body size: 1 MB is plenty for a document. The company settings carry the logo
 * (a data URI) and synchronization sends whole batches of offline work: they get more.
 */
const smallJson = express.json({ limit: "1mb" });
const largeJson = express.json({ limit: "10mb" });
const companyJson = express.json({ limit: "3mb" });
const formBody = express.urlencoded({ extended: false, limit: "1mb" });

function bodyParsers(req: Request, res: Response, next: NextFunction): void {
  // A database backup is read by its own route, as raw bytes and with a larger limit.
  if (req.path === "/system/restore") {
    next();
    return;
  }
  const parser = req.path.startsWith("/sync")
    ? largeJson
    : req.path.startsWith("/company")
      ? companyJson
      : smallJson;
  parser(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    formBody(req, res, next);
  });
}

export function registerRoutes(app: Express): void {
  app.use(corsMiddleware);
  app.use(securityHeaders);

  /**
   * Availability probe. The client also uses it to tell "the browser thinks it is
   * online" from "the server answers" (`SYNC_STRATEGY.md` §8): it must therefore stay
   * lightweight, unauthenticated and without database access by default.
   *
   * Mounted **before** rate limiting: a device that used up its quota (a large
   * offline prefetch) is still online, and must not be told otherwise.
   */
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Desktop workstations older than the supported release: refused before anything
  // else, so no outdated payload reaches a domain.
  app.use("/api", clientVersionGate);

  app.use("/api", apiRateLimit);
  // Bodies are read only once the request has passed rate limiting.
  app.use("/api", bodyParsers);
  // Writes replayed by the offline queue: a given key is executed only once. Technical
  // operations are never queued offline, and a restore replaces the log itself.
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/system/")) next();
    else void idempotency(req, res, next);
  });

  app.get("/api/health/db", async (_req, res) => {
    try {
      await pool.query("select 1");
      res.json({ status: "ok", database: "up" });
    } catch {
      res.status(503).json({ status: "degraded", database: "down", code: "DB_CONNECTION" });
    }
  });

  // Features disabled for the company (POS, purchasing…): 403 straight away.
  app.use("/api", featureGate);

  // --- Core ----------------------------------------------------------------
  registerAuthRoutes(app);
  registerTenancyRoutes(app);
  registerUsersRoutes(app);
  registerPluginsRoutes(app);
  registerPartiesRoutes(app);
  registerCatalogRoutes(app);
  registerServicesRoutes(app);
  registerInventoryRoutes(app);
  registerPurchasingRoutes(app);
  registerSalesRoutes(app);
  registerInvoicingRoutes(app);
  registerPaymentsRoutes(app);
  registerBankingRoutes(app);
  registerPosRoutes(app);
  registerAccountingRoutes(app);
  registerReportsRoutes(app);
  registerSyncRoutes(app);
  registerSystemRoutes(app);
  registerDesktopRoutes(app);

  app.use(apiNotFound);
  app.use(errorHandler);
}
