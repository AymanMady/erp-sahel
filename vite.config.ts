import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
/** Single source of the release number: the web app, the desktop shell and its installers. */
const appVersion = (
  JSON.parse(fs.readFileSync(path.resolve(rootDir, "package.json"), "utf8")) as { version: string }
).version;

/**
 * `DESKTOP_` keys of `.env` / `.env.desktop`. `loadEnv` also passes the `NODE_ENV` of
 * these files on to Vite (`VITE_USER_NODE_ENV`): the server's `NODE_ENV=development` in
 * `.env` would turn the desktop shell into a development build — React's development
 * checks, and every effect run twice, the local database opened twice at once.
 */
function desktopEnv(mode: string): Record<string, string> {
  const before = process.env.VITE_USER_NODE_ENV;
  const env = loadEnv(mode, rootDir, "DESKTOP_");
  if (before === undefined) delete process.env.VITE_USER_NODE_ENV;
  return env;
}

export default defineConfig(({ mode }) => {
  /**
   * "Desktop" build: static shell embedded by Tauri (`src-tauri`).
   * Relative paths + hash routing, since the page is served from `file://` /
   * `asset://` and not by our Express server.
   */
  const isDesktop = mode === "desktop";
  /**
   * Optional server pre-filled in the desktop shell (e.g. `https://erp.example.com`),
   * read from `DESKTOP_API_URL` in the environment or in `.env.desktop`. Left empty,
   * one installer serves every customer: the server is asked at first launch. Always
   * empty on the web build: the API is then same-origin.
   */
  const desktopApiUrl = isDesktop
    ? (process.env.DESKTOP_API_URL ?? desktopEnv(mode).DESKTOP_API_URL ?? "")
    : "";

  return {
    base: isDesktop ? "./" : "/",
    root: path.resolve(rootDir, "client"),
    plugins: [react(), tailwindcss()],
    define: {
      __DESKTOP_BUILD__: JSON.stringify(isDesktop),
      __API_BASE_URL__: JSON.stringify(desktopApiUrl.replace(/\/+$/, "")),
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    resolve: {
      alias: {
        "@": path.resolve(rootDir, "client", "src"),
        "@shared": path.resolve(rootDir, "shared"),
      },
    },
    build: {
      outDir: isDesktop
        ? path.resolve(rootDir, "src-tauri", "dist")
        : path.resolve(rootDir, "dist", "public"),
      emptyOutDir: true,
      sourcemap: mode !== "production",
      // The admin + POS shell ships as a single entry; the bundle routinely exceeds
      // Vite's 500 kB threshold, which is expected.
      chunkSizeWarningLimit: 1600,
    },
    server: {
      fs: { strict: true, deny: ["**/.*"] },
    },
  };
});
