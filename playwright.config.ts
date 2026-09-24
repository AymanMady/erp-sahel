import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * The test server runs on a dedicated port with its own database: E2E tests create real
 * invoices, they must not pollute the working environment.
 *
 * Specs select elements by their English UI text: the browser locale is English and
 * each spec also forces the stored UI language (`erp.language`) before loading.
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
    locale: "en-GB",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `NODE_ENV=production PORT=${PORT} node dist/index.cjs`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
