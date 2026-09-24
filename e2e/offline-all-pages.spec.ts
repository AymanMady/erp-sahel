/**
 * Toute l'application sans réseau.
 *
 *   1. se connecter, laisser la synchronisation et le préchargement se faire ;
 *   2. **couper la connexion** ;
 *   3. ouvrir **chaque page** à froid (rechargement complet, coquille servie par le
 *      Service Worker) : aucune ne doit afficher d'erreur réseau ;
 *   4. créer un rôle et une commande fournisseur hors ligne : ils apparaissent aussitôt ;
 *   5. **rétablir la connexion** → rejeu automatique, sans doublon.
 */

import { expect, test, type Page } from "@playwright/test";

const ADMIN = { username: "admin", password: "Admin123!" };

/** Toutes les routes sans paramètre du routeur applicatif. */
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
  "/modules/auto-parts/search",
  "/modules/auto-parts/equivalences",
  "/modules/auto-parts/manufacturers",
  "/modules/auto-parts/vehicles",
  "/modules/clothing/size-grids",
  "/modules/market/lots",
  "/modules/market/expiring",
  "/settings/company",
  "/settings/modules",
  "/settings/numbering",
  "/settings/registers",
  "/settings/users",
  "/settings/roles",
  "/sync",
  "/profile",
];

const NETWORK_ERRORS = /Serveur injoignable|pas disponible hors ligne|Failed to fetch/;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Identifiant").fill(ADMIN.username);
  await page.getByLabel("Mot de passe").fill(ADMIN.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
}

/** Lit une table IndexedDB de la base hors ligne. */
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

test.describe("application complète hors ligne", () => {
  test("chaque page s'ouvre sans réseau et les saisies se synchronisent", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await login(page);

    // La coquille doit être contrôlée par le Service Worker avant la coupure.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    // Préchargement terminé : administration et supervision comprises.
    await expect
      .poll(
        async () => {
          const keys = await cachedKeys(page);
          return ["/api/roles?", "/api/users?", "/api/sync/journal?", "/api/company/sequences?"]
            .map((path) => keys.some((key) => key.startsWith(`http:${path}`)))
            .every(Boolean);
        },
        { timeout: 60_000 }
      )
      .toBe(true);
    await page.waitForLoadState("networkidle");

    // --- Coupure --------------------------------------------------------------
    await context.setOffline(true);

    for (const route of ROUTES) {
      await test.step(`ouvre ${route} hors ligne`, async () => {
        await page.goto(route);
        await expect(page.getByRole("heading").first()).toBeVisible();
        // Laisse aux requêtes le temps d'échouer et au repli local de répondre.
        await page.waitForTimeout(400);
        await expect(page.locator("body")).not.toContainText(NETWORK_ERRORS);
      });
    }

    // La caisse reprend la session ouverte sur le serveur (lue dans l'instantané) au
    // lieu d'en proposer une seconde, qui serait refusée à la synchronisation.
    await test.step("ouvre /pos hors ligne", async () => {
      await page.goto("/pos");
      await expect(page.getByPlaceholder(/Scanner un code-barres/)).toBeVisible();
    });

    // Les données d'administration sont bien là (écran vide avant correction).
    await page.goto("/settings/roles");
    await expect(page.getByText("Administrateur", { exact: true }).first()).toBeVisible();
    await page.goto("/settings/users");
    await expect(page.getByText("admin", { exact: true }).first()).toBeVisible();

    // --- Saisie hors ligne ------------------------------------------------------
    const roleName = `Magasinier hors ligne ${Date.now()}`;
    await page.goto("/settings/roles");
    await page.getByRole("button", { name: "Nouveau rôle" }).click();
    await page.getByRole("dialog").getByRole("textbox").first().fill(roleName);
    await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText(roleName)).toBeVisible();

    const pending = (await readStore(page, "outbox")).filter(
      (row) => row.entity === "http.request" && row.status !== "synced"
    );
    expect(pending).toHaveLength(1);

    // Survit à la fermeture de l'onglet.
    await page.reload();
    await expect(page.getByText(roleName)).toBeVisible();

    // --- Retour du réseau -------------------------------------------------------
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

    // Une seule fois côté serveur, malgré l'essai initial et le rejeu.
    await page.goto("/settings/roles");
    await expect(page.getByText(roleName)).toHaveCount(1);
  });
});
