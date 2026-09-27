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
  permissions,
  posRegisters,
  productVariants,
  products,
  rolePermissions,
  roles,
  services,
  stockItems,
  userCompanies,
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
  /**
   * Whether the password hashes of the cashiers may be sent: a desktop approved by an
   * administrator, asked for by someone who works at the register.
   */
  includeOfflineLogins: boolean;
}

/**
 * Start of the next delta, read from the **database** clock and taken a little in the
 * past: a change written by a transaction still running when the snapshot is read has
 * an earlier `updated_at`, and would otherwise be missed forever. Rows in the overlap
 * are simply sent twice; the device overwrites them.
 */
export async function syncCursor(): Promise<string> {
  const result = await db.execute<{ cursor: Date | string }>(
    sql`select now() - interval '2 minutes' as cursor`
  );
  return new Date(result.rows[0].cursor).toISOString();
}

export async function buildSyncSnapshot(options: SnapshotOptions) {
  const { companyId, userId } = options;
  const cursor = await syncCursor();

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
    cursor,
    company: company
      ? {
          id: company.id,
          name: company.name,
          legalName: company.legalName,
          currency: company.currency,
          language: company.language,
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
    offlineAuthUsers: options.includeOfflineLogins ? await buildOfflineAuthUsers(companyId) : [],
  };
}

/**
 * Bcrypt hashes enabling a **cold offline login** on an already-synchronized device.
 *
 * Reserved to a desktop shell approved by an administrator: there, the snapshot lives
 * in an application SQLite database, not in browser storage. In the web PWA, opening
 * offline relies on the already-established session (still-valid refresh token) —
 * pushing hashes down into IndexedDB would add risk without benefit ([NFR-SEC-5], Q4).
 *
 * Only people who work at the register are included, never those who can administer
 * the company (users, settings, modules) nor platform administrators: a copied hash of
 * those accounts would open far more than a register.
 */
async function buildOfflineAuthUsers(companyId: string) {
  const result = await db.execute<{
    id: string;
    username: string;
    password_hash: string;
    first_name: string;
    last_name: string;
    permissions: string[];
  }>(sql`
    select u.id, u.username, u.password_hash, u.first_name, u.last_name,
           array_agg(distinct p.code) as permissions
    from ${users} u
    join ${userCompanies} uc on uc.user_id = u.id and uc.company_id = ${companyId} and uc.is_active
    join ${userRoles} ur on ur.user_id = u.id and ur.company_id = ${companyId}
    join ${roles} r on r.id = ur.role_id and r.is_active
    join ${rolePermissions} rp on rp.role_id = r.id
    join ${permissions} p on p.id = rp.permission_id
    where u.is_active and u.allow_offline_login and not u.is_superuser
    group by u.id
    having bool_or(p.code = 'pos.use')
       and not bool_or(p.code in ('users.write', 'settings.write', 'modules.manage'))
  `);
  return result.rows.map((row) => ({
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    isSuperuser: false,
    firstName: row.first_name,
    lastName: row.last_name,
    /** What the offline session may show: the account's own rights, nothing more. */
    permissions: row.permissions,
  }));
}
