/**
 * Entry point of the Vercel serverless function (API only).
 *
 * The static client is served directly by Vercel's CDN; only `/api/*` requests reach
 * this function. Initialization (modules, session purge) is done once per instance,
 * then reused by subsequent requests.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { Express } from "express";

import { createApp } from "./app";
import { logger } from "./shared/logging/logger";

let appPromise: Promise<Express> | undefined;

function getApp(): Promise<Express> {
  appPromise ??= createApp().catch((error: unknown) => {
    // Retry on the next request rather than keeping a failed instance.
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
    logger.error("API initialization failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "unavailable", code: "INIT_FAILED" }));
  }
}
