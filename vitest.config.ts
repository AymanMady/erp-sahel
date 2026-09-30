import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { assertLocalDatabase, resolveTestDatabaseUrl } from "./scripts/test-database";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Never the `.env` database, which may be production (`scripts/test-database.ts`).
const testDatabaseUrl = resolveTestDatabaseUrl();
assertLocalDatabase(testDatabaseUrl);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "client", "src"),
      "@shared": path.resolve(rootDir, "shared"),
    },
  },
  test: {
    environment: "node",
    // Set before any test module loads: `dotenv` (server/db.ts) then leaves it alone.
    env: { DATABASE_URL: testDatabaseUrl },
    setupFiles: ["./scripts/test-setup.ts"],
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
    // Integration tests share a PostgreSQL database: running them in parallel would
    // make them step on each other (same sequences, same companies).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
