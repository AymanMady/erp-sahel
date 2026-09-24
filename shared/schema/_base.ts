/**
 * Building blocks shared by every table of the schema.
 *
 * Non-negotiable conventions (see `docs/ARCHITECTURE.md`):
 *  - **UUID primary keys** everywhere ([NFR-DATA-1]): the offline client generates its
 *    own identifiers, and the server must accept them as they are.
 *  - **`company_id` on every tenant-scoped entity** ([BR-13]): isolation is a column,
 *    not a usage convention.
 *  - **Amounts in integer cents**, **rates in basis points** (see `shared/money.ts`).
 *  - **Soft-delete** via `is_active` on master data; accounting documents are never
 *    deleted ([BR-10], [NFR-DATA-2]).
 *  - **Unique `client_uuid`** on syncable entities: it is the idempotency key that
 *    guarantees "synced exactly once" ([BR-8]).
 */

import { boolean, integer, numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/** Creation/update timestamps present on every table. */
export const auditTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/** Base columns of an entity: identity, timestamps, soft-delete. */
export const baseColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  ...auditTimestamps,
  isActive: boolean("is_active").default(true).notNull(),
};

/** Quantity stored with 3 decimals; on the JS side it is a `string` (never a float). */
export const quantity = (name: string) => numeric(name, { precision: 16, scale: 3 });

/** Amount in integer cents. `bigint` not needed: 2^31 cents ≈ 21 M units. */
export const moneyCents = (name: string) => integer(name);

/** Rate in basis points (16 % ⇒ 1600). */
export const rateBp = (name: string) => integer(name);

/**
 * Idempotency key of operations created offline.
 * `null` for entities created online — the partial unique constraint
 * (`WHERE client_uuid IS NOT NULL`) is defined in the migration.
 */
export const clientUuid = () => uuid("client_uuid");
