/**
 * Point d'entrée du serveur ERP Sahel.
 *
 * Démarrage : validation de la configuration → enregistrement des modules →
 * installation du registre de plugins → routes → client (Vite en dev, statique en prod).
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import compression from "compression";
import express from "express";

import { closeDatabase, pool } from "./db";
import { assertTokenConfiguration } from "./domains/auth/tokens";
import { authRepository } from "./domains/auth/repository";
import { pluginRegistry } from "./domains/plugins/registry";
import { registerPlugins } from "./modules";
import { registerRoutes } from "./routes";
import { logger } from "./shared/logging/logger";

const app = express();
const httpServer = createServer(app);

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

async function bootstrap(): Promise<void> {
  assertTokenConfiguration();

  registerPlugins();
  await pluginRegistry.installAll();

  const purged = await authRepository.purgeExpiredTokens();
  if (purged > 0) logger.info("Sessions expirées purgées", { count: purged });

  registerRoutes(app);

  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
    const { serveStatic } = await import("./static");
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(app, httpServer);
  }

  const port = Number(process.env.PORT ?? 5000);
  httpServer.listen(port, () => {
    logger.info(`ERP Sahel démarré sur http://localhost:${port}`, {
      env: process.env.NODE_ENV ?? "development",
      modules: pluginRegistry.list().map((plugin) => plugin.meta.code),
    });
  });
}

/** Arrêt propre : on cesse d'accepter des connexions avant de fermer le pool. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Signal ${signal} reçu, arrêt en cours…`);
  httpServer.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  // Filet de sécurité si une connexion ouverte empêche la fermeture.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

bootstrap().catch(async (error) => {
  logger.error("Échec du démarrage", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  await pool.end().catch(() => undefined);
  process.exit(1);
});
