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
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  logger.info(`Signal ${signal} received, shutting down…`);
  const close = async () => {
    await closeDatabase();
    process.exit(exitCode);
  };
  if (httpServer) httpServer.close(close);
  else void close();
  // Safety net in case an open connection prevents shutdown.
  setTimeout(() => process.exit(1), 10_000).unref();
}

// A forgotten promise must not kill the server in the middle of a sale: log it.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
// After an uncaught exception the process state is unknown: log, then stop cleanly so
// the host restarts it.
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { message: error.message, stack: error.stack });
  void shutdown("uncaughtException", 1);
});

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
