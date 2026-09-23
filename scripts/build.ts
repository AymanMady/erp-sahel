/**
 * Build de production : client Vite + serveur groupé en un seul fichier.
 *
 * Le serveur est empaqueté en CommonJS (`dist/index.cjs`) avec ses dépendances
 * externalisées : c'est le format qui démarre le plus simplement sur un hébergement
 * mutualisé, sans exiger la résolution ESM ni un `package.json` particulier à côté.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: rootDir, stdio: "inherit" });
}

/**
 * Liste les ressources produites par Vite pour que le Service Worker les mette en cache
 * dès l'installation. Sans cela, seules les pages déjà visitées seraient disponibles
 * hors ligne — les routes étant chargées à la demande.
 */
function writePrecacheManifest(): void {
  const publicDir = path.join(rootDir, "dist", "public");
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
    `// Généré par scripts/build.ts — ne pas modifier à la main.\nself.__ERP_PRECACHE = ${JSON.stringify(urls, null, 2)};\n`,
    "utf-8"
  );
  console.log(`  ${urls.length} ressources ajoutées au pré-cache.`);
}

async function main(): Promise<void> {
  fs.rmSync(path.join(rootDir, "dist"), { recursive: true, force: true });

  console.log("→ Build du client (Vite)…");
  run("npx", ["vite", "build"]);

  console.log("→ Génération du manifeste de pré-cache…");
  writePrecacheManifest();

  console.log("→ Build du serveur (esbuild)…");
  await build({
    entryPoints: [path.join(rootDir, "server/index.ts")],
    outfile: path.join(rootDir, "dist/index.cjs"),
    platform: "node",
    target: "node20",
    format: "cjs",
    bundle: true,
    minify: true,
    sourcemap: true,
    // `pg` et ses dépendances natives doivent rester externes : les empaqueter
    // casserait le chargement des modules optionnels (`pg-native`, `cloudflare:sockets`).
    packages: "external",
    // `import.meta.url` n'existe pas en CommonJS : on le réécrit vers l'équivalent
    // calculé depuis `__filename`, sinon `fileURLToPath` reçoit `undefined` au
    // démarrage du bundle.
    banner: {
      js: 'const __import_meta_url = require("node:url").pathToFileURL(__filename).href;',
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": "__import_meta_url",
      "import.meta.dirname": "__dirname",
    },
    logLevel: "info",
  });

  console.log("\n✔ Build terminé.");
  console.log("  Client  : dist/public/");
  console.log("  Serveur : dist/index.cjs");
  console.log("  Démarrage : npm start");
}

main().catch((error) => {
  console.error("Échec du build :", error);
  process.exit(1);
});
