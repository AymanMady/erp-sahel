/** Serves the client's static files in production. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express } from "express";

const here = path.dirname(fileURLToPath(import.meta.url));

export function clientDistPath(): string {
  // In production, `dist/index.cjs` and `dist/public/` are siblings.
  return path.resolve(here, "public");
}

/**
 * Serves the SPA: assets with a long cache (they carry a hash), `index.html` and the
 * service worker **without cache** — otherwise a device would keep an old version of
 * the offline shell forever after an update.
 */
export function serveStatic(app: Express): void {
  const distPath = clientDistPath();
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Client build not found in ${distPath}. Run "npm run build" before "npm start".`
    );
  }

  app.use(
    express.static(distPath, {
      index: false,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        // The Service Worker and its manifest must be revalidated on every load:
        // otherwise a device would keep an old shell forever.
        if (
          name === "sw.js" ||
          name === "precache-manifest.js" ||
          name === "manifest.webmanifest" ||
          name === "index.html"
        ) {
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
          return;
        }
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );

  // Every non-API route renders the SPA (client-side routing).
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}
