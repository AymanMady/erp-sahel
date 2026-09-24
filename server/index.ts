/**
 * ERP Sahel server entry point.
 *
 * Startup: configuration validation → routes → client (Vite in dev, static files in
 * prod).
 */

import "dotenv/config";
import { createServer, type Server } from "node:http";

import { createApp } from "./app";
import { closeDatabase, pool } from "./db";
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
    logger.info(`ERP Sahel started on http://localhost:${port}`, {
      env: process.env.NODE_ENV ?? "development",
    });
  });
}

/** Graceful shutdown: stop accepting connections before closing the pool. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Signal ${signal} received, shutting down…`);
  const close = async () => {
    await closeDatabase();
    process.exit(0);
  };
  if (httpServer) httpServer.close(close);
  else void close();
  // Safety net in case an open connection prevents shutdown.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

bootstrap().catch(async (error) => {
  logger.error("Startup failed", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  await pool.end().catch(() => undefined);
  process.exit(1);
});
