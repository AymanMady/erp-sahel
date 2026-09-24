/** Service Worker precache manifest, shared by the build scripts. */

import fs from "node:fs";
import path from "node:path";

/**
 * Lists the assets produced by Vite so that the Service Worker caches them at install
 * time. Without this, only already-visited pages would be available offline — since
 * routes are loaded on demand.
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
    `// Generated at build time — do not edit by hand.\nself.__ERP_PRECACHE = ${JSON.stringify(urls, null, 2)};\n`,
    "utf-8"
  );
  console.log(`  ${urls.length} assets added to the precache.`);
}
