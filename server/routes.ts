/**
 * Composition root of the HTTP routes.
 *
 * Deliberate order: security → rate limiting → health → core domains → modules →
 * API 404 → error handler. The error handler must remain **the last** mounted
 * middleware, otherwise exceptions from later routes would escape it.
 */

import type { Express } from "express";

import { apiRateLimit } from "./middleware/rate-limit";
import { idempotency } from "./middleware/idempotency";
import { apiNotFound, errorHandler } from "./middleware/error-handler";
import { corsMiddleware, securityHeaders } from "./middleware/security";
import { pool } from "./db";
import { registerAccountingRoutes } from "./domains/accounting/routes";
import { registerAuthRoutes } from "./domains/auth/routes";
import { registerBankingRoutes } from "./domains/banking/routes";
import { registerCatalogRoutes } from "./domains/catalog/routes";
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
import { registerTenancyRoutes } from "./domains/tenancy/routes";
import { registerUsersRoutes } from "./domains/users/routes";

export function registerRoutes(app: Express): void {
  app.use(corsMiddleware);
  app.use(securityHeaders);
  app.use("/api", apiRateLimit);
  // Writes replayed by the offline queue: a given key is executed only once.
  app.use("/api", idempotency);

  /**
   * Availability probe. The client also uses it to tell "the browser thinks it is
   * online" from "the server answers" (`SYNC_STRATEGY.md` §8): it must therefore stay
   * lightweight, unauthenticated and without database access by default.
   */
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
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

  app.use(apiNotFound);
  app.use(errorHandler);
}
