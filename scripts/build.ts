/**
 * Production build: Vite client + server bundled into a single file.
 *
 * The server is bundled as CommonJS (`dist/index.cjs`) with its dependencies
 * externalized: it is the format that starts most easily on shared hosting, without
 * requiring ESM resolution or a special `package.json` next to it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { writePrecacheManifest } from "./precache";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: rootDir, stdio: "inherit" });
}

async function main(): Promise<void> {
  fs.rmSync(path.join(rootDir, "dist"), { recursive: true, force: true });

  console.log("→ Building client (Vite)…");
  run("npx", ["vite", "build"]);

  console.log("→ Generating precache manifest…");
  writePrecacheManifest(path.join(rootDir, "dist", "public"));

  console.log("→ Building server (esbuild)…");
  await build({
    entryPoints: [path.join(rootDir, "server/index.ts")],
    outfile: path.join(rootDir, "dist/index.cjs"),
    platform: "node",
    target: "node20",
    format: "cjs",
    bundle: true,
    minify: true,
    sourcemap: true,
    // `pg` and its native dependencies must stay external: bundling them would break
    // loading of optional modules (`pg-native`, `cloudflare:sockets`).
    packages: "external",
    // `import.meta.url` does not exist in CommonJS: we rewrite it to the equivalent
    // computed from `__filename`, otherwise `fileURLToPath` receives `undefined` when
    // the bundle starts.
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

  console.log("\n✔ Build complete.");
  console.log("  Client  : dist/public/");
  console.log("  Server  : dist/index.cjs");
  console.log("  Start   : npm start");
}

main().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
