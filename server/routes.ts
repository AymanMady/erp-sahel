/**
 * Racine de composition des routes HTTP.
 *
 * Ordre volontaire : sécurité → limitation de débit → santé → domaines du noyau →
 * modules → 404 API → gestionnaire d'erreurs. Le gestionnaire d'erreurs doit rester
 * **le dernier** middleware monté, sinon les exceptions des routes suivantes lui
 * échapperaient.
 */

import type { Express } from "express";

import { apiRateLimit } from "./middleware/rate-limit";
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
import { registerPluginsRoutes } from "./domains/plugins/routes";
import { registerPosRoutes } from "./domains/pos/routes";
import { registerPurchasingRoutes } from "./domains/purchasing/routes";
import { registerReportsRoutes } from "./domains/reports/routes";
import { registerSalesRoutes } from "./domains/sales/routes";
import { registerServicesRoutes } from "./domains/services/routes";
import { registerSyncRoutes } from "./domains/sync/routes";
import { registerTenancyRoutes } from "./domains/tenancy/routes";
import { registerUsersRoutes } from "./domains/users/routes";
import { registerModuleRoutes } from "./modules";

export function registerRoutes(app: Express): void {
  app.use(corsMiddleware);
  app.use(securityHeaders);
  app.use("/api", apiRateLimit);

  /**
   * Sonde de disponibilité. Le client s'en sert aussi pour distinguer « le navigateur
   * se croit en ligne » de « le serveur répond » (`SYNC_STRATEGY.md` §8) : elle doit
   * donc rester légère, non authentifiée et sans accès base par défaut.
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

  // --- Noyau ---------------------------------------------------------------
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

  // --- Modules métier ------------------------------------------------------
  registerModuleRoutes(app);

  app.use(apiNotFound);
  app.use(errorHandler);
}
