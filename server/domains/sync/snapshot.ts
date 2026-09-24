/**
 * Building the offline snapshot.
 *
 * This is the **minimal dataset** that lets a device keep selling without network:
 * catalog with stock, active parties, services, registers, current session, payment
 * methods, and the enabled modules ([FR-SYNC-1], [FR-SYNC-2]).
 *
 * Deliberately bounded scope ([NFR-SEC-5]): no accounting, no invoice history, no data
 * from other companies. Whatever is not needed for counter sales does not go down to
 * the device.
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
import { moduleRegistry } from "../plugins/registry";
import { posApplication } from "../pos/application";
import { syncDispatcher } from "./dispatcher";

/** Local cache bounds: beyond these, the device gets slow and memory suffers. */
const SNAPSHOT_LIMITS = {
  products: 5000,
  parties: 2000,
  services: 500,
} as const;

export interface SnapshotOptions {
  companyId: string;
  userId: string;
  /** `desktop` (Tauri) or `web` (PWA) — determines whether password hashes are sent. */
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

  const enabledModules = await moduleRegistry.listForCompany(companyId);

  return {
    generatedAt: new Date().toISOString(),
    /** Cursor to pass back to `pull` to fetch only subsequent changes. */
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
      .map((entry) => ({ code: entry.code, name: entry.name })),
    /** Entities this server accepts for offline writes. */
    syncEntities: syncDispatcher.entities(),
    offlineAuthUsers: await buildOfflineAuthUsers(companyId, platform),
  };
}

/**
 * Bcrypt hashes enabling a **cold offline login** on an already-synchronized device.
 *
 * Reserved to the desktop shell: there, the snapshot lives in an application SQLite
 * database, not in browser storage. In the web PWA, opening offline relies on the
 * already-established session (still-valid refresh token) — pushing hashes down into
 * IndexedDB would add risk without benefit ([NFR-SEC-5], Q4).
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
