import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  /**
   * "Desktop" build: static shell embedded by Tauri (`src-tauri`).
   * Relative paths + hash routing, since the page is served from `file://` /
   * `asset://` and not by our Express server.
   */
  const isDesktop = mode === "desktop";
  /**
   * Server the desktop shell talks to (e.g. `https://erp.example.com`). Read from
   * `DESKTOP_API_URL` in the environment or in `.env.desktop`. Empty on the web build:
   * the API is then same-origin.
   */
  const desktopApiUrl = isDesktop
    ? (process.env.DESKTOP_API_URL ?? loadEnv(mode, rootDir, "DESKTOP_").DESKTOP_API_URL ?? "")
    : "";
  if (isDesktop && !desktopApiUrl) {
    throw new Error("Desktop build: set DESKTOP_API_URL (environment or .env.desktop).");
  }

  return {
    base: isDesktop ? "./" : "/",
    root: path.resolve(rootDir, "client"),
    plugins: [react(), tailwindcss()],
    define: {
      __DESKTOP_BUILD__: JSON.stringify(isDesktop),
      __API_BASE_URL__: JSON.stringify(desktopApiUrl.replace(/\/+$/, "")),
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
