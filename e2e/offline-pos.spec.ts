/**
 * End-to-end scenario from the specification (§16.3 and §17):
 *
 *   1. sign in and open the register;
 *   2. **cut the connection**;
 *   3. ring up a sale offline;
 *   4. close then reopen the application → the sale is still there;
 *   5. **restore the connection** → automatic synchronization, without duplication.
 *
 * The network is cut at the browser context level (`setOffline`), which faithfully
 * reproduces an outage: requests fail, `navigator.onLine` flips, and the Service Worker
 * serves the shell from its cache.
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

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
}

test.describe("offline sale at the counter", () => {
  test("charges without network, persists, then synchronizes without duplicate", async ({
    page,
    context,
  }) => {
    await login(page);

    // --- 1. Opening the register, online ------------------------------------
    await page.goto("/pos");
    const openButton = page.getByRole("button", { name: "Open the register" });
    if (await openButton.isVisible().catch(() => false)) {
      await openButton.click();
    }
    await expect(page.getByPlaceholder(/Scan a barcode/)).toBeVisible();

    // The snapshot must be in place before the outage: without it, no product search
    // would be possible offline.
    await page.waitForTimeout(1500);

    // --- 2. Network outage --------------------------------------------------
    await context.setOffline(true);
    await expect(page.getByText(/Offline mode/)).toBeVisible();

    // --- 3. Offline sale ----------------------------------------------------
    await page.getByPlaceholder(/Scan a barcode/).fill("FH");
    await page.waitForTimeout(600);
    // Demo product name, as seeded (data, not UI text).
    await page
      .locator("button", { hasText: /Filtre à huile|Oil filter/ })
      .first()
      .click();

    await page.getByRole("button", { name: /Charge/ }).click();
    await page.getByRole("button", { name: "Validate" }).click();

    // The ticket gets a provisional number, not a legal one. The selector targets the
    // cart confirmation, not the transient toast that shows similar text.
    await expect(page.getByText(/Ticket OFFLINE-TKT-\d+ paid \(offline/)).toBeVisible();

    // --- 4. Close / reopen ----------------------------------------------------
    await page.reload();
    await expect(page.getByText(/Offline mode/)).toBeVisible();

    await page.goto("/sync");
    // The local queue holds at least the invoice and its payment.
    await expect(page.getByRole("tab", { name: "Local queue" })).toBeVisible();
    await expect(page.getByText(/OFFLINE-TKT-\d+/).first()).toBeVisible();

    // --- 5. Network back ---------------------------------------------------
    await context.setOffline(false);
    await page.getByRole("button", { name: "Synchronize" }).click();

    // The queue empties and the legal number replaces the provisional one.
    await expect(page.getByText(/FAC-\d{4}-\d{4}/).first()).toBeVisible({ timeout: 20_000 });

    // --- Duplicate check -------------------------------------------------------
    await page.goto("/invoices");
    const ticketRows = page.getByRole("row").filter({ hasText: "POS" });
    const countBefore = await ticketRows.count();

    // Running another synchronization must not recreate anything ([BR-8]).
    await page.goto("/sync");
    await page.getByRole("button", { name: "Synchronize" }).click();
    await page.waitForTimeout(2000);

    await page.goto("/invoices");
    await expect(page.getByRole("row").filter({ hasText: "POS" })).toHaveCount(countBefore);
  });
});

test.describe("offline shell", () => {
  test("the application opens without network once cached", async ({ page, context }) => {
    await login(page);
    // Let the Service Worker cache the shell.
    await page.waitForTimeout(2000);

    await context.setOffline(true);
    await page.goto("/");

    // The interface stays rendered: this is requirement [FR-SYNC-1].
    await expect(page.getByText(/Offline mode/)).toBeVisible();
    await expect(page.locator("#root")).not.toBeEmpty();
  });
});
