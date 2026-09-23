/**
 * Middleware Vite en développement : un seul port pour l'API et le client.
 *
 * Évite d'avoir deux origines en dev (et donc une configuration CORS différente de la
 * production) — le comportement observé en développement est celui de la production.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";

import type { Express } from "express";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function setupVite(app: Express, server: Server): Promise<void> {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configFile: path.resolve(rootDir, "vite.config.ts"),
    server: { middlewareMode: true, hmr: { server } },
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use(async (req, res, next) => {
    if (req.originalUrl.startsWith("/api/")) {
      next();
      return;
    }
    try {
      const templatePath = path.resolve(rootDir, "client", "index.html");
      const template = await vite.transformIndexHtml(
        req.originalUrl,
        await fs.promises.readFile(templatePath, "utf-8")
      );
      res.status(200).set({ "Content-Type": "text/html" }).end(template);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}
