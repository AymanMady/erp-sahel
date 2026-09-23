/**
 * Point d'entrée du serveur ERP Sahel.
 *
 * Démarrage : validation de la configuration → enregistrement des modules →
 * installation du registre de plugins → routes → client (Vite en dev, statique en prod).
 */

import "dotenv/config";
import { createServer, type Server } from "node:http";

import { createApp } from "./app";
import { closeDatabase, pool } from "./db";
import { pluginRegistry } from "./domains/plugins/registry";
import { logger } from "./shared/logging/logger";

let httpServer: Server | undefined;

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const server = createServer(app);
  httpServer = server;

  if (process.env.NODE_ENV === "production") {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  }

  const port = Number(process.env.PORT ?? 5000);
  server.listen(port, () => {
    logger.info(`ERP Sahel démarré sur http://localhost:${port}`, {
      env: process.env.NODE_ENV ?? "development",
      modules: pluginRegistry.list().map((plugin) => plugin.meta.code),
    });
  });
}

/** Arrêt propre : on cesse d'accepter des connexions avant de fermer le pool. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Signal ${signal} reçu, arrêt en cours…`);
  const close = async () => {
    await closeDatabase();
    process.exit(0);
  };
  if (httpServer) httpServer.close(close);
  else void close();
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
