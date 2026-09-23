/** Service des fichiers statiques du client en production. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express } from "express";

const here = path.dirname(fileURLToPath(import.meta.url));

export function clientDistPath(): string {
  // En production, `dist/index.cjs` et `dist/public/` sont frères.
  return path.resolve(here, "public");
}

/**
 * Sert la SPA : assets avec cache long (ils portent un hash), `index.html` et le
 * service worker **sans cache** — sinon un poste garderait indéfiniment une ancienne
 * version de la coquille hors-ligne après une mise à jour.
 */
export function serveStatic(app: Express): void {
  const distPath = clientDistPath();
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Build client introuvable dans ${distPath}. Lancez « npm run build » avant « npm start ».`
    );
  }

  app.use(
    express.static(distPath, {
      index: false,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        // Le Service Worker et son manifeste doivent être revalidés à chaque
        // chargement : un poste garderait sinon indéfiniment une ancienne coquille.
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

  // Toute route non-API rend la SPA (routage côté client).
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}
