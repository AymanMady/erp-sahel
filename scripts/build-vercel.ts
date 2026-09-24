/**
 * Vercel build: produces `.vercel/output/` in the Build Output API v3 format.
 *
 * - `static/`           : the Vite client, served by Vercel's CDN;
 * - `functions/api.func`: the Express API as a Node serverless function;
 * - `config.json`       : routing (static files, then `/api/*`, then the SPA).
 *
 * We bundle the server ourselves (esbuild resolves the `@shared` aliases), then
 * `@vercel/nft` traces the dependencies actually loaded — including files read at
 * runtime, such as pdfkit's AFM fonts — to copy them into the function.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeFileTrace } from "@vercel/nft";
import { build } from "esbuild";

import { writePrecacheManifest } from "./precache";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(rootDir, ".vercel", "output");
const functionDir = path.join(outputDir, "functions", "api.func");
const bundlePath = path.join(rootDir, "dist", "vercel", "server.cjs");

const NO_CACHE = { "cache-control": "no-cache, must-revalidate" };

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: rootDir, stdio: "inherit" });
}

async function buildClient(): Promise<void> {
  console.log("→ Building client (Vite)…");
  run("npx", ["vite", "build"]);

  const publicDir = path.join(rootDir, "dist", "public");
  writePrecacheManifest(publicDir);
  fs.cpSync(publicDir, path.join(outputDir, "static"), { recursive: true });
}

async function buildFunction(): Promise<void> {
  console.log("→ Building API function (esbuild)…");
  await build({
    entryPoints: [path.join(rootDir, "server/vercel.ts")],
    outfile: bundlePath,
    platform: "node",
    target: "node22",
    format: "cjs",
    bundle: true,
    minify: true,
    // See scripts/build.ts: `pg` and friends stay external.
    packages: "external",
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

  console.log("→ Tracing dependencies (@vercel/nft)…");
  const { fileList } = await nodeFileTrace([bundlePath], { base: rootDir });
  for (const file of fileList) {
    const source = path.join(rootDir, file);
    if (!fs.statSync(source).isFile()) continue;
    const target = path.join(functionDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  console.log(`  ${fileList.size} files copied into the function.`);

  fs.writeFileSync(
    path.join(functionDir, ".vc-config.json"),
    JSON.stringify(
      {
        runtime: "nodejs22.x",
        handler: path.relative(rootDir, bundlePath),
        launcherType: "Nodejs",
        shouldAddHelpers: false,
        maxDuration: 30,
      },
      null,
      2
    )
  );
}

function writeConfig(): void {
  const config = {
    version: 3,
    routes: [
      // Hashed assets: long cache. Offline shell: always revalidated.
      {
        src: "^/assets/(.*)$",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        continue: true,
      },
      {
        src: "^/(sw\\.js|precache-manifest\\.js|manifest\\.webmanifest|index\\.html)$",
        headers: NO_CACHE,
        continue: true,
      },
      { handle: "filesystem" },
      { src: "^/api(/.*)?$", dest: "/api" },
      // Any other route serves the SPA (client-side routing).
      { src: "^/(.*)$", dest: "/index.html", headers: NO_CACHE },
    ],
  };
  fs.writeFileSync(path.join(outputDir, "config.json"), JSON.stringify(config, null, 2));
}

async function main(): Promise<void> {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.rmSync(path.join(rootDir, "dist"), { recursive: true, force: true });

  await buildClient();
  await buildFunction();
  writeConfig();

  console.log("\n✔ Vercel build complete: .vercel/output/");
}

main().catch((error) => {
  console.error("Vercel build failed:", error);
  process.exit(1);
});
