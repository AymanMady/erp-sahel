/**
 * Real-life outages, where the browser still believes it is online:
 *
 *  - **Wi-Fi without internet**: the box is there, but requests never get an answer
 *    (they hang instead of failing);
 *  - **server without its database**: the application server answers, but its database
 *    (in the cloud) is out of reach — every data request ends in an error after a long
 *    wait.
 *
 * In both cases, once the device is ready, every screen must show the local copy
 * quickly, as with the network cut.
 *
 * The second scenario pauses the test database container: it only runs when
 * `E2E_DB_CONTAINER` names it (e.g. `E2E_DB_CONTAINER=erp-sahel-db`).
 */

import { execSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

const ADMIN = { username: "admin", password: "Admin123!" };
const NETWORK_ERRORS =
  /No internet connection\.|Failed to fetch|not available offline|didn't work/i;
/** A screen must show its data well before the server's own time limits. */
const FAST_MS = 8000;
const ROUTES: [string, RegExp | string][] = [
  ["/", "Total sales"],
  ["/invoices", /FAC-\d{4}-\d{4}/],
  ["/parties", /./],
  ["/products", /./],
  ["/payments", /./],
  ["/purchase-orders", /./],
  ["/settings/roles", /./],
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("erp.language", "en");
    } catch {
      // The `locale` of the Playwright config still selects English.
    }
  });
});

async function loginAndPrepare(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Total sales").first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const request = indexedDB.open("erp-sahel-offline");
              request.onerror = () => resolve(false);
              request.onsuccess = () => {
                const get = request.result
                  .transaction("meta")
                  .objectStore("meta")
                  .get("prefetch.completedAt");
                get.onsuccess = () => resolve(Boolean(get.result));
                get.onerror = () => resolve(false);
              };
            })
        ),
      { timeout: 120_000 }
    )
    .toBe(true);
}

async function expectScreensFromLocalCopy(page: Page): Promise<void> {
  for (const [route, content] of ROUTES) {
    await test.step(`opens ${route}`, async () => {
      await page.goto(route);
      const heading =
        route === "/" ? page.getByText(content).first() : page.getByRole("heading").first();
      await expect(heading).toBeVisible({ timeout: FAST_MS });
      if (route !== "/") {
        await expect(
          page.locator("main").getByText(content).filter({ visible: true }).first()
        ).toBeVisible({ timeout: FAST_MS });
      }
      await page.waitForTimeout(300);
      await expect(page.locator("body")).not.toContainText(NETWORK_ERRORS);
    });
  }
}

test("Wi-Fi without internet: requests hang, screens still show the local copy", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await loginAndPrepare(page);

  // Every API request hangs forever; the page itself still comes from the cache.
  await page.route("**/api/**", () => {
    // Never answered, like a packet lost on a box without internet.
  });
  await expectScreensFromLocalCopy(page);
});

test("server up but its database out of reach: screens show the local copy", async ({ page }) => {
  const container = process.env.E2E_DB_CONTAINER;
  test.skip(!container, "E2E_DB_CONTAINER not set");
  test.setTimeout(300_000);
  await loginAndPrepare(page);

  execSync(`docker pause ${container}`);
  try {
    await expectScreensFromLocalCopy(page);
  } finally {
    execSync(`docker unpause ${container}`);
  }
});
