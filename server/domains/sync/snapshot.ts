/**
 * Construction de l'instantané hors-ligne.
 *
 * C'est le **jeu de données minimal** qui permet à un poste de continuer à vendre sans
 * réseau : catalogue avec stock, tiers actifs, prestations, caisses, session en cours,
 * modes de règlement, et les référentiels des modules activés ([FR-SYNC-1], [FR-SYNC-2]).
 *
 * Périmètre volontairement borné ([NFR-SEC-5]) : ni comptabilité, ni historique de
 * factures, ni données d'autres sociétés. Ce qui n'est pas nécessaire à la vente au
 * comptoir ne descend pas sur le poste.
 */

import { asc, eq, sql } from "drizzle-orm";

import {
  bankAccounts,
  categories,
  parties,
  posRegisters,
  productVariants,
  products,
  roles,
  services,
  stockItems,
  userRoles,
  users,
  warehouses,
} from "@shared/schema";
import { db } from "../../db";
import { pluginRegistry } from "../plugins/registry";
import { posApplication } from "../pos/application";
import { syncDispatcher } from "./dispatcher";

/** Bornes du cache local : au-delà, le poste devient lent et la mémoire souffre. */
const SNAPSHOT_LIMITS = {
  products: 5000,
  parties: 2000,
  services: 500,
} as const;

export interface SnapshotOptions {
  companyId: string;
  userId: string;
  /** `desktop` (Tauri) ou `web` (PWA) — conditionne l'envoi des empreintes de mot de passe. */
  platform: string;
}

export async function buildSyncSnapshot(options: SnapshotOptions) {
  const { companyId, userId, platform } = options;

  const [
    company,
    categoryRows,
    productRows,
    variantRows,
    stockRows,
    partyRows,
    serviceRows,
    warehouseRows,
    registerRows,
    paymentAccountRows,
    session,
  ] = await Promise.all([
    db.query.companies.findFirst({ where: (table, { eq: equals }) => equals(table.id, companyId) }),
    db
      .select()
      .from(categories)
      .where(sql`${categories.companyId} = ${companyId} and ${categories.isActive}`)
      .orderBy(asc(categories.name)),
    db
      .select()
      .from(products)
      .where(sql`${products.companyId} = ${companyId} and ${products.isActive}`)
      .orderBy(asc(products.name))
      .limit(SNAPSHOT_LIMITS.products),
    db
      .select()
      .from(productVariants)
      .where(sql`${productVariants.companyId} = ${companyId} and ${productVariants.isActive}`),
    db
      .select({
        productId: stockItems.productId,
        warehouseId: stockItems.warehouseId,
        quantity: sql<string>`coalesce(sum(${stockItems.quantity}), 0)`,
      })
      .from(stockItems)
      .where(eq(stockItems.companyId, companyId))
      .groupBy(stockItems.productId, stockItems.warehouseId),
    db
      .select()
      .from(parties)
      .where(sql`${parties.companyId} = ${companyId} and ${parties.isActive}`)
      .orderBy(asc(parties.name))
      .limit(SNAPSHOT_LIMITS.parties),
    db
      .select()
      .from(services)
      .where(sql`${services.companyId} = ${companyId} and ${services.isActive}`)
      .orderBy(asc(services.name))
      .limit(SNAPSHOT_LIMITS.services),
    db
      .select()
      .from(warehouses)
      .where(sql`${warehouses.companyId} = ${companyId} and ${warehouses.isActive}`),
    db
      .select()
      .from(posRegisters)
      .where(sql`${posRegisters.companyId} = ${companyId} and ${posRegisters.isActive}`),
    db
      .select({
        id: bankAccounts.id,
        code: bankAccounts.code,
        name: bankAccounts.name,
        accountType: bankAccounts.accountType,
        currency: bankAccounts.currency,
        isDefault: bankAccounts.isDefault,
      })
      .from(bankAccounts)
      .where(sql`${bankAccounts.companyId} = ${companyId} and ${bankAccounts.isActive}`),
    posApplication.currentSession(companyId, userId),
  ]);

  const enabledModules = await pluginRegistry.listForCompany(companyId);
  const moduleData: Record<string, unknown> = {};
  for (const plugin of pluginRegistry.list()) {
    const enabled = enabledModules.find((entry) => entry.code === plugin.meta.code)?.isEnabled;
    if (!enabled || !plugin.buildSnapshot) continue;
    moduleData[plugin.meta.code] = await plugin.buildSnapshot(db, companyId);
  }

  return {
    generatedAt: new Date().toISOString(),
    /** Curseur à repasser à `pull` pour ne récupérer que les changements ultérieurs. */
    cursor: new Date().toISOString(),
    company: company
      ? {
          id: company.id,
          name: company.name,
          legalName: company.legalName,
          currency: company.currency,
          language: company.language,
          vatEnabled: company.vatEnabled,
          defaultVatRateBp: company.defaultVatRateBp,
          logo: company.logo,
          address: company.address,
          phone: company.phone,
          email: company.email,
          taxId: company.taxId,
        }
      : null,
    categories: categoryRows,
    products: productRows,
    variants: variantRows,
    stock: stockRows,
    parties: partyRows,
    services: serviceRows,
    warehouses: warehouseRows,
    registers: registerRows,
    paymentAccounts: paymentAccountRows,
    session,
    modules: enabledModules
      .filter((entry) => entry.isEnabled)
      .map((entry) => ({ code: entry.code, name: entry.name, version: entry.version })),
    moduleData,
    /** Entités que ce serveur accepte en écriture hors-ligne. */
    syncEntities: syncDispatcher.entities(),
    offlineAuthUsers: await buildOfflineAuthUsers(companyId, platform),
  };
}

/**
 * Empreintes bcrypt permettant une **connexion hors-ligne à froid** sur un poste déjà
 * synchronisé.
 *
 * Réservé à la coquille desktop : là, l'instantané vit dans un SQLite applicatif, pas
 * dans le stockage du navigateur. En PWA web, l'ouverture hors-ligne s'appuie sur la
 * session déjà établie (jeton de rafraîchissement en cours de validité) — descendre des
 * empreintes dans IndexedDB apporterait un risque sans bénéfice ([NFR-SEC-5], Q4).
 */
async function buildOfflineAuthUsers(companyId: string, platform: string) {
  if (platform !== "desktop") return [];
  const rows = await db
    .selectDistinct({
      id: users.id,
      username: users.username,
      passwordHash: users.passwordHash,
      isSuperuser: users.isSuperuser,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      sql`${userRoles.companyId} = ${companyId} and ${users.isActive} and ${users.allowOfflineLogin}`
    );
  return rows;
}
