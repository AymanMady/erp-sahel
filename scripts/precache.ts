/** Manifeste de pré-cache du Service Worker, partagé par les scripts de build. */

import fs from "node:fs";
import path from "node:path";

/**
 * Liste les ressources produites par Vite pour que le Service Worker les mette en cache
 * dès l'installation. Sans cela, seules les pages déjà visitées seraient disponibles
 * hors ligne — les routes étant chargées à la demande.
 */
export function writePrecacheManifest(publicDir: string): void {
  const assetsDir = path.join(publicDir, "assets");
  if (!fs.existsSync(assetsDir)) return;

  const assets = fs
    .readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
    .map((name) => `/assets/${name}`);

  const extras = ["/icons/icon-192.png", "/icons/icon-512.png"].filter((entry) =>
    fs.existsSync(path.join(publicDir, entry.replace(/^\//, "")))
  );

  const urls = [...assets, ...extras];
  fs.writeFileSync(
    path.join(publicDir, "precache-manifest.js"),
    `// Généré au build — ne pas modifier à la main.\nself.__ERP_PRECACHE = ${JSON.stringify(urls, null, 2)};\n`,
    "utf-8"
  );
  console.log(`  ${urls.length} ressources ajoutées au pré-cache.`);
}
