/**
 * Scénario end-to-end du cahier des charges (§16.3 et §17) :
 *
 *   1. se connecter et ouvrir la caisse ;
 *   2. **couper la connexion** ;
 *   3. encaisser une vente hors ligne ;
 *   4. fermer puis rouvrir l'application → la vente est toujours là ;
 *   5. **rétablir la connexion** → synchronisation automatique, sans duplication.
 *
 * Le réseau est coupé au niveau du contexte navigateur (`setOffline`), ce qui reproduit
 * fidèlement une coupure : les requêtes échouent, `navigator.onLine` bascule, et le
 * Service Worker sert la coquille depuis son cache.
 */

import { expect, test, type Page } from "@playwright/test";

const ADMIN = { username: "admin", password: "Admin123!" };

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Identifiant").fill(ADMIN.username);
  await page.getByLabel("Mot de passe").fill(ADMIN.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
}

test.describe("vente hors ligne au comptoir", () => {
  test("encaisse sans réseau, persiste, puis se synchronise sans doublon", async ({
    page,
    context,
  }) => {
    await login(page);

    // --- 1. Ouverture de la caisse, en ligne -------------------------------
    await page.goto("/pos");
    const openButton = page.getByRole("button", { name: "Ouvrir la caisse" });
    if (await openButton.isVisible().catch(() => false)) {
      await openButton.click();
    }
    await expect(page.getByPlaceholder(/Scanner un code-barres/)).toBeVisible();

    // L'instantané doit être en place avant la coupure : sans lui, aucune recherche
    // produit ne serait possible hors ligne.
    await page.waitForTimeout(1500);

    // --- 2. Coupure réseau -------------------------------------------------
    await context.setOffline(true);
    await expect(page.getByText(/Mode hors ligne/)).toBeVisible();

    // --- 3. Vente hors ligne ----------------------------------------------
    await page.getByPlaceholder(/Scanner un code-barres/).fill("FH");
    await page.waitForTimeout(600);
    await page.locator("button", { hasText: "Filtre à huile" }).first().click();

    await page.getByRole("button", { name: /Encaisser/ }).click();
    await page.getByRole("button", { name: "Valider" }).click();

    // Le ticket reçoit un numéro provisoire, pas un numéro légal. Le sélecteur cible
    // la confirmation du panier, pas la notification éphémère qui affiche le même texte.
    await expect(page.getByText(/Ticket OFFLINE-TKT-\d+ encaissé/)).toBeVisible();

    // --- 4. Fermeture / réouverture ---------------------------------------
    await page.reload();
    await expect(page.getByText(/Mode hors ligne/)).toBeVisible();

    await page.goto("/sync");
    // La file locale contient au moins la facture et son règlement.
    await expect(page.getByRole("tab", { name: "File locale" })).toBeVisible();
    await expect(page.getByText(/OFFLINE-TKT-\d+/).first()).toBeVisible();

    // --- 5. Retour du réseau ----------------------------------------------
    await context.setOffline(false);
    await page.getByRole("button", { name: "Synchroniser" }).click();

    // La file se vide et le numéro légal remplace le provisoire.
    await expect(page.getByText(/FAC-\d{4}-\d{4}/).first()).toBeVisible({ timeout: 20_000 });

    // --- Vérification anti-doublon ----------------------------------------
    await page.goto("/invoices");
    const ticketRows = page.getByRole("row").filter({ hasText: "Caisse" });
    const countBefore = await ticketRows.count();

    // Relancer une synchronisation ne doit rien recréer ([BR-8]).
    await page.goto("/sync");
    await page.getByRole("button", { name: "Synchroniser" }).click();
    await page.waitForTimeout(2000);

    await page.goto("/invoices");
    await expect(page.getByRole("row").filter({ hasText: "Caisse" })).toHaveCount(countBefore);
  });
});

test.describe("coquille hors ligne", () => {
  test("l'application s'ouvre sans réseau une fois mise en cache", async ({ page, context }) => {
    await login(page);
    // Laisse le Service Worker mettre la coquille en cache.
    await page.waitForTimeout(2000);

    await context.setOffline(true);
    await page.goto("/");

    // L'interface reste rendue : c'est l'exigence [FR-SYNC-1].
    await expect(page.getByText(/Mode hors ligne/)).toBeVisible();
    await expect(page.locator("#root")).not.toBeEmpty();
  });
});
