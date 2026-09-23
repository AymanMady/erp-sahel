import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration end-to-end.
 *
 * Le serveur de test est lancé sur un port dédié avec sa propre base : les tests E2E
 * créent de vraies factures, ils ne doivent pas polluer l'environnement de travail.
 */
const PORT = Number(process.env.E2E_PORT ?? 5100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `NODE_ENV=production PORT=${PORT} node dist/index.cjs`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
