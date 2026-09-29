/**
 * After the first sign-in, **all** the data is on the device — not only the screens
 * already opened.
 *
 *   1. sign in and wait until the device reports it is ready to work without internet;
 *   2. cut the connection;
 *   3. open documents never displayed: the oldest invoice (beyond the first page of
 *      200), a return, a goods receipt, a supplier invoice;
 *   4. the next day, still without network: the home screen and reports still open.
 *
 * Needs more than 200 invoices on the test server (more than one prefetch page).
 */

import { expect, test, type Page } from "@playwright/test";

const ADMIN = { username: "admin", password: "Admin123!" };
/** Messages of a screen that could not get its data. */
const NETWORK_ERRORS = /No internet connection\.|Failed to fetch|not available offline/;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("erp.language", "en");
    } catch {
      // The `locale` of the Playwright config still selects English.
    }
  });
});

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Total sales").first()).toBeVisible();
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

async function expectNoNetworkError(page: Page): Promise<void> {
  // Give requests time to fail and the local copy time to answer.
  await page.waitForTimeout(500);
  await expect(page.locator("body")).not.toContainText(NETWORK_ERRORS);
}

test("every document is available offline after the first sign-in", async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(300_000);

  // The oldest invoice, which is not on the first page of 200.
  const auth = await (await request.post("/api/auth/login", { data: ADMIN })).json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const firstPage = await (await request.get("/api/invoices?limit=1&offset=0", { headers })).json();
  expect(firstPage.total, "the test needs more than 200 invoices").toBeGreaterThan(200);
  const oldest = (
    await (
      await request.get(`/api/invoices?limit=1&offset=${firstPage.total - 1}`, { headers })
    ).json()
  ).items[0] as { id: string; number: string };

  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  // The device says when everything is downloaded.
  await expect
    .poll(async () => Date.parse((await readMeta(page, "prefetch.completedAt")) ?? "") || 0, {
      timeout: 180_000,
    })
    .toBeGreaterThan(0);

  // --- Outage ---------------------------------------------------------------
  await context.setOffline(true);

  await test.step("oldest invoice, never opened", async () => {
    await page.goto(`/invoices/${oldest.id}`);
    await expect(page.getByText(oldest.number).first()).toBeVisible();
    await expectNoNetworkError(page);
  });

  await test.step("invoice list: search finds the oldest invoice", async () => {
    await page.goto("/invoices");
    await page.getByPlaceholder("Number or customer…").fill(oldest.number);
    await expect(page.getByText(oldest.number).filter({ visible: true }).first()).toBeVisible();
    await expectNoNetworkError(page);
  });

  await test.step("purchase order never opened", async () => {
    await page.goto("/purchase-orders");
    const row = page.locator("tbody tr").filter({ visible: true }).last();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/\/purchase-orders\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expectNoNetworkError(page);
  });

  for (const route of ["/credit-notes", "/goods-receipts", "/supplier-invoices"]) {
    await test.step(`detail from ${route}`, async () => {
      await page.goto(route);
      await expect(page.getByRole("heading").first()).toBeVisible();
      const row = page.locator("tbody tr").filter({ visible: true }).first();
      await expect(row).toBeVisible();
      await row.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoNetworkError(page);
    });
  }

  // --- Next day, still offline -----------------------------------------------
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await page.clock.setFixedTime(tomorrow);
  for (const route of ["/", "/reports/sales", "/reports/purchases"]) {
    await test.step(`opens ${route} the next day`, async () => {
      await page.goto(route);
      const ready =
        route === "/" ? page.getByText("Total sales").first() : page.getByRole("heading").first();
      await expect(ready).toBeVisible();
      await expectNoNetworkError(page);
    });
  }
});
