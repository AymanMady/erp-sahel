/**
 * Point d'entrée de la fonction serverless Vercel (API uniquement).
 *
 * Le client statique est servi directement par le CDN de Vercel ; seules les requêtes
 * `/api/*` arrivent ici. L'initialisation (modules, purge des sessions) est faite une
 * fois par instance, puis réutilisée par les requêtes suivantes.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { Express } from "express";

import { createApp } from "./app";
import { logger } from "./shared/logging/logger";

let appPromise: Promise<Express> | undefined;

function getApp(): Promise<Express> {
  appPromise ??= createApp().catch((error: unknown) => {
    // On retente à la requête suivante plutôt que de garder une instance en échec.
    appPromise = undefined;
    throw error;
  });
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await getApp();
    app(req, res);
  } catch (error) {
    logger.error("Échec de l'initialisation de l'API", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "unavailable", code: "INIT_FAILED" }));
  }
}
