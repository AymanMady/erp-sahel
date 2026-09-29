/**
 * The whole application without network.
 *
 *   1. sign in, let synchronization and prefetching happen;
 *   2. **cut the connection**;
 *   3. open **every page** cold (full reload, shell served by the Service Worker): none
 *      may display a network error;
 *   4. create a role offline: it shows up right away;
 *   5. **restore the connection** → automatic replay, without duplicate.
 */

import { expect, test, type Page } from "@playwright/test";

const ADMIN = { username: "admin", password: "Admin123!" };

/**
 * Selectors use the English UI strings: force the UI language before any page script
 * runs, whatever the language stored or detected in the browser.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("erp.language", "en");
    } catch {
      // Storage unavailable: the `locale` of the Playwright config still selects English.
    }
  });
});

/** Every parameterless route of the application router. */
const ROUTES = [
  "/",
  "/parties",
  "/products",
  "/products/new",
  "/categories",
  "/services",
  "/inventory",
  "/inventory/movements",
  "/warehouses",
  "/quotes",
  "/quotes/new",
  "/sales-orders",
  "/invoices",
  "/invoices/new",
  "/credit-notes",
  "/payments",
  "/purchase-orders",
  "/purchase-orders/new",
  "/goods-receipts",
  "/supplier-invoices",
  "/banking",
  "/accounting/entries",
  "/accounting/ledger",
  "/accounting/balance",
  "/accounting/accounts",
  "/reports/sales",
  "/reports/stock",
  "/reports/purchases",
  "/settings/company",
  "/settings/modules",
  "/settings/registers",
  "/settings/users",
  "/settings/roles",
  "/sync",
  "/profile",
];

/** Messages of a screen that could not get its data (English UI, `offline:api.*`). */
const NETWORK_ERRORS = /No internet connection\.|not available offline|Failed to fetch/;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Home screen reached: its sales summary is shown.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Total sales").first()).toBeVisible();
}

/** Reads a table of the offline IndexedDB database. */
function readStore(page: Page, store: "cache" | "meta" | "outbox") {
  return page.evaluate(
    (name) =>
      new Promise<{ key?: string; status?: string; entity?: string; value?: unknown }[]>(
        (resolve, reject) => {
          const request = indexedDB.open("erp-sahel-offline");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const all = request.result.transaction(name).objectStore(name).getAll();
            all.onsuccess = () => resolve(all.result);
            all.onerror = () => reject(all.error);
          };
        }
      ),
    store
  );
}

async function cachedKeys(page: Page): Promise<string[]> {
  return (await readStore(page, "cache")).map((row) => String(row.key));
}

test.describe("whole application offline", () => {
  test("every page opens without network and entries synchronize", async ({ page, context }) => {
    test.setTimeout(240_000);
    await login(page);

    // The shell must be controlled by the Service Worker before the outage.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    // The device says when everything is downloaded (administration included). The
    // pass records it only once over: no request of it is still in flight. (Waiting for
    // "network idle" never ends: the app checks the server every few seconds.)
    await expect
      .poll(
        async () => {
          const meta = await readStore(page, "meta");
          const completedAt = meta.find((row) => row.key === "prefetch.completedAt")?.value;
          return Boolean(completedAt);
        },
        { timeout: 120_000 }
      )
      .toBe(true);
    const keys = await cachedKeys(page);
    for (const path of ["/api/roles?", "/api/users?"]) {
      expect(keys.some((key) => key.startsWith(`http:${path}`))).toBe(true);
    }

    // --- Outage ---------------------------------------------------------------
    await context.setOffline(true);

    for (const route of ROUTES) {
      await test.step(`opens ${route} offline`, async () => {
        await page.goto(route);
        // The home screen has no title, only its figures; every other page has one.
        const ready =
          route === "/" ? page.getByText("Total sales").first() : page.getByRole("heading").first();
        await expect(ready).toBeVisible();
        // Give requests time to fail and the local fallback time to answer.
        await page.waitForTimeout(400);
        await expect(page.locator("body")).not.toContainText(NETWORK_ERRORS);
      });
    }

    // The POS resumes the session opened on the server (read from the snapshot)
    // instead of offering a second one, which would be rejected at synchronization.
    await test.step("opens /pos offline", async () => {
      await page.goto("/pos");
      await expect(page.getByPlaceholder(/Scan the barcode/)).toBeVisible();
    });

    // Administration data is there (the screen used to be empty).
    await page.goto("/settings/roles");
    // System role name as seeded (English since the i18n migration, French before).
    // Lists exist twice (table on a computer, cards on a phone): take the one shown.
    await expect(
      page
        .getByText(/^Administrat(or|eur)$/)
        .filter({ visible: true })
        .first()
    ).toBeVisible();
    await page.goto("/settings/users");
    await expect(
      page.getByText("admin", { exact: true }).filter({ visible: true }).first()
    ).toBeVisible();

    // --- Offline entry -----------------------------------------------------------
    const roleName = `Offline storekeeper ${Date.now()}`;
    await page.goto("/settings/roles");
    await page.getByRole("button", { name: "New role" }).click();
    await page.getByRole("dialog").getByRole("textbox").first().fill(roleName);
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(roleName)).toBeVisible();

    const pending = (await readStore(page, "outbox")).filter(
      (row) => row.entity === "http.request" && row.status !== "synced"
    );
    expect(pending).toHaveLength(1);

    // Survives closing the tab.
    await page.reload();
    await expect(page.getByText(roleName)).toBeVisible();

    // --- Network back ------------------------------------------------------------
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(
        async () =>
          (await readStore(page, "outbox"))
            .filter((row) => row.entity === "http.request")
            .every((row) => row.status === "synced"),
        { timeout: 60_000 }
      )
      .toBe(true);

    // Only once on the server, despite the initial attempt and the replay.
    await page.goto("/settings/roles");
    await expect(page.getByText(roleName)).toHaveCount(1);
  });
});
