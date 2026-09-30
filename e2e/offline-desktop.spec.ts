/**
 * The desktop application without internet, from its very first connection.
 *
 * The desktop shell is played in the browser (`support/desktop-shell.ts`): the same web
 * application, with its local database stand-in kept across reloads.
 *
 *   1. sign in for the first time: the local database downloads the documents, the
 *      preparation of the device downloads the rest — no page is opened meanwhile;
 *   2. cut the connection;
 *   3. open every page, cold: none may show a network error;
 *   4. documents never opened (an invoice, a purchase order) show their content, read
 *      from the local database.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const ADMIN = { username: "admin", password: "Admin123!" };
/** Messages of a screen that could not get its data (English UI, `offline:api.*`). */
const NETWORK_ERRORS = /No internet connection\.|not available offline|Failed to fetch/;

/** The shell, bundled for the page. */
const SHELL = buildSync({
  entryPoints: [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "support", "desktop-shell.ts"),
  ],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
}).outputFiles[0].text;

/** Every parameterless route of the application router, desktop screen included. */
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
  "/settings/desktop-app",
  "/settings/registers",
  "/settings/users",
  "/settings/roles",
  "/profile",
  "/device",
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("erp.language", "en");
    } catch {
      // Storage unavailable: the `locale` of the Playwright config still selects English.
    }
  });
  await page.addInitScript({ content: SHELL });
});

/** A purchase order entered from another device: never opened on this one. */
async function enterPurchaseOrder(
  request: APIRequestContext
): Promise<{ id: string; number: string }> {
  const auth = await (await request.post("/api/auth/login", { data: ADMIN })).json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const products = await (await request.get("/api/catalog/products?limit=1", { headers })).json();
  const supplier = await (
    await request.post("/api/parties", {
      headers,
      data: { name: `Grossiste ${Date.now()}`, partyType: "SUPPLIER" },
    })
  ).json();
  return (
    await request.post("/api/purchase-orders", {
      headers,
      data: {
        supplierId: supplier.id,
        lines: [{ productId: products.items[0].id, quantity: 4, unitPriceCents: 1000 }],
      },
    })
  ).json();
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Total sales").first()).toBeVisible();
}

/** Keys of the device's copy of the server answers (IndexedDB `cache`). */
function cachedKeys(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("erp-sahel-offline");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const keys = request.result.transaction("cache").objectStore("cache").getAllKeys();
          keys.onsuccess = () => resolve(keys.result.map(String));
          keys.onerror = () => reject(keys.error);
        };
      })
  );
}

function readMeta(page: Page, key: string) {
  return page.evaluate(
    (wanted) =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open("erp-sahel-offline");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const get = request.result.transaction("meta").objectStore("meta").get(wanted);
          get.onsuccess = () => resolve((get.result?.value as string | undefined) ?? null);
          get.onerror = () => reject(get.error);
        };
      }),
    key
  );
}

/** Whether the local database finished its first download. */
function localDatabaseComplete(page: Page) {
  return page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("e2e.desktop.local-db") ?? "null") as {
      meta: [string, string][];
    } | null;
    return Boolean(saved?.meta.some(([key]) => key === "bootstrap_completed_at"));
  });
}

test("the desktop works without internet on every page after its first connection", async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(240_000);
  const order = await enterPurchaseOrder(request);

  await login(page);
  // The shell must be controlled by the Service Worker before the outage (browser only:
  // the real shell embeds its files).
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  // First connection: the local database, then the rest — nothing else is opened.
  await expect.poll(() => localDatabaseComplete(page), { timeout: 120_000 }).toBe(true);
  await expect
    .poll(async () => Boolean(await readMeta(page, "prefetch.completedAt")), { timeout: 120_000 })
    .toBe(true);
  // The documents were not downloaded one by one: the local database holds them.
  const keys = await cachedKeys(page);
  for (const path of ["/api/invoices", "/api/quotes", "/api/purchase-orders", "/api/payments"]) {
    expect(
      keys.some((key) => key.startsWith(`http:${path}`)),
      path
    ).toBe(false);
  }
  // What the local database does not hold is in the device's copy.
  for (const path of ["/api/roles?", "/api/accounting/accounts?", "/api/banking/accounts?"]) {
    expect(
      keys.some((key) => key.startsWith(`http:${path}`)),
      path
    ).toBe(true);
  }

  // --- Outage ---------------------------------------------------------------
  await context.setOffline(true);

  for (const route of ROUTES) {
    await test.step(`opens ${route} offline`, async () => {
      await page.goto(route);
      const ready =
        route === "/" ? page.getByText("Total sales").first() : page.getByRole("heading").first();
      await expect(ready).toBeVisible();
      // Give requests time to fail and the local copy time to answer.
      await page.waitForTimeout(400);
      await expect(page.locator("body")).not.toContainText(NETWORK_ERRORS);
    });
  }

  await test.step("invoices, never opened, are listed and open", async () => {
    await page.goto("/invoices");
    const row = page.locator("tbody tr").filter({ visible: true }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading").first()).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.locator("body")).not.toContainText(NETWORK_ERRORS);
  });

  await test.step("a purchase order entered elsewhere, never opened", async () => {
    await page.goto(`/purchase-orders/${order.id}`);
    await expect(page.getByText(order.number).first()).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.locator("body")).not.toContainText(NETWORK_ERRORS);
  });

  await test.step("payments are listed", async () => {
    await page.goto("/payments");
    await expect(page.locator("tbody tr").filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(NETWORK_ERRORS);
  });

  await context.setOffline(false);
});
