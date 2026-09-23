/**
 * Construction de l'application Express, sans démarrage HTTP.
 *
 * Partagée par le serveur classique (`index.ts`, qui ajoute le client puis écoute un
 * port) et par la fonction serverless Vercel (`vercel.ts`, qui ne sert que `/api`).
 */

import { randomUUID } from "node:crypto";

import compression from "compression";
import express, { type Express } from "express";

import { assertTokenConfiguration } from "./domains/auth/tokens";
import { authRepository } from "./domains/auth/repository";
import { pluginRegistry } from "./domains/plugins/registry";
import { registerPlugins } from "./modules";
import { registerRoutes } from "./routes";
import { logger } from "./shared/logging/logger";

/**
 * Valide la configuration, installe les modules et enregistre les routes API.
 * Le client (Vite ou statique) reste à la charge de l'appelant.
 */
export async function createApp(): Promise<Express> {
  assertTokenConfiguration();

  const app = express();

  // Derrière un proxy (hébergeur, Vercel) : l'IP réelle sert au rate limiting.
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

  // 10 Mo : un logo de société en data URI passe, un import de fichier volumineux non
  // (ces imports passeront par un envoi dédié, pas par le corps JSON).
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
  app.use(compression());

  /** Identifiant de corrélation propagé dans les journaux et les réponses d'erreur. */
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

  registerPlugins();
  await pluginRegistry.installAll();

  const purged = await authRepository.purgeExpiredTokens();
  if (purged > 0) logger.info("Sessions expirées purgées", { count: purged });

  registerRoutes(app);

  return app;
}
