import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  /**
   * Build « desktop » : coquille statique embarquée par Tauri (`src-tauri`).
   * Chemins relatifs + routage par hash, puisque la page est servie depuis `file://`
   * / `asset://` et non par notre serveur Express.
   */
  const isDesktop = mode === "desktop";

  return {
    base: isDesktop ? "./" : "/",
    root: path.resolve(rootDir, "client"),
    plugins: [react(), tailwindcss()],
    define: {
      __DESKTOP_BUILD__: JSON.stringify(isDesktop),
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
      // Le shell admin + POS part en une seule entrée ; le bundle dépasse
      // régulièrement le seuil de 500 kB de Vite sans que ce soit anormal.
      chunkSizeWarningLimit: 1600,
    },
    server: {
      fs: { strict: true, deny: ["**/.*"] },
    },
  };
});
