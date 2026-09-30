/**
 * Ingestion log of offline operations — the guarantor of idempotency [BR-8].
 *
 * Each operation of the client outbox carries a `client_uuid` generated on the workstation.
 * The uniqueness of this column is what makes "replaying the same batch" a no-op:
 * the second ingestion returns `duplicate` + the already assigned `server_id`, without writing.
 */

import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { auditTimestamps } from "./_base";
import { users } from "./accounts";
import { companies } from "./tenancy";

/**
 * `pending`: an HTTP write whose idempotency key is taken while the request runs, so that
 * a second copy arriving at the same moment waits instead of running twice.
 */
export const SYNC_STATUSES = ["created", "duplicate", "error", "deferred", "pending"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const syncOperations = pgTable(
  "sync_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Idempotency key provided by the client. */
    clientUuid: uuid("client_uuid").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Target entity, prefixed by domain (`invoicing.sales_invoice`). */
    entity: text("entity").notNull(),
    action: text("action").default("create").notNull(),
    status: text("status").$type<SyncStatus>().notNull(),
    /** Created server identifier — used to resolve cross-references within a batch. */
    serverId: text("server_id").default("").notNull(),
    /** Final number assigned, returned to the client to replace the provisional one. */
    assignedNumber: text("assigned_number").default("").notNull(),
    /** Causal order in the workstation's outbox (`SYNC_STRATEGY.md` §4). */
    localSeq: integer("local_seq").default(0).notNull(),
    deviceId: text("device_id").default("").notNull(),
    detail: text("detail").default("").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex("uq_sync_operations_client_uuid").on(table.clientUuid),
    index("idx_sync_operations_company_created").on(table.companyId, table.createdAt),
    index("idx_sync_operations_entity").on(table.companyId, table.entity),
  ]
);

export type SyncOperation = typeof syncOperations.$inferSelect;

/**
 * Tracking of synced workstations: last snapshot served, last upload.
 * Used for field diagnostics ("this workstation has not synced for 3 days").
 */
export const syncDevices = pgTable(
  "sync_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    label: text("label").default("").notNull(),
    platform: text("platform").default("web").notNull(),
    lastUserId: uuid("last_user_id").references(() => users.id, { onDelete: "set null" }),
    lastSnapshotAt: timestamp("last_snapshot_at", { withTimezone: true }),
    lastPushAt: timestamp("last_push_at", { withTimezone: true }),
    pendingHint: integer("pending_hint").default(0).notNull(),
    /**
     * Approved by an administrator for signing in without network: only such a desktop
     * receives the password hashes of the cashiers.
     */
    offlineLoginAllowed: boolean("offline_login_allowed").default(false).notNull(),
    ...auditTimestamps,
  },
  (table) => [uniqueIndex("uq_sync_devices").on(table.companyId, table.deviceId)]
);

export type SyncDevice = typeof syncDevices.$inferSelect;

/**
 * 64-bit transaction id (`pg_current_xact_id()`). Never wraps around; read as text.
 */
const xid8 = customType<{ data: string; driverData: string }>({
  dataType: () => "xid8",
});

/**
 * Change log read by the offline workstations (`GET /api/sync/pull`).
 *
 * Filled **only by PostgreSQL triggers** (migration 0006) on the synchronized tables:
 * every insert, update and delete is recorded, including physical deletes and writes
 * whose code forgot `updated_at`. A line change is recorded on its document (`entity`
 * is always a root table), which the workstation then reloads whole.
 *
 * The pull cursor is a transaction id, not `seq`: a transaction commits in no particular
 * order relative to the sequence it drew from, so a cursor on `seq` could step over a
 * change still being written. See `docs/OFFLINE_SYNC.md` §Cursor.
 *
 * No foreign key on `company_id`: deleting a company logs the deletion of its rows in
 * the same statement.
 */
export const syncChanges = pgTable(
  "sync_changes",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    txid: xid8("txid").notNull(),
    companyId: uuid("company_id").notNull(),
    /** Root table name (`products`, `sales_invoices`…). */
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** `I`nsert, `U`pdate or `D`elete — informative: the pull reads the current row. */
    op: text("op").$type<"I" | "U" | "D">().notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_sync_changes_company_txid").on(table.companyId, table.txid, table.seq),
    index("idx_sync_changes_changed_at").on(table.changedAt),
  ]
);

export type SyncChange = typeof syncChanges.$inferSelect;

/**
 * How far the change log has been purged: a workstation whose cursor is older must
 * download everything again (`resync`). A single row.
 */
export const syncHorizon = pgTable("sync_horizon", {
  id: integer("id").primaryKey().default(1),
  purgedTxid: xid8("purged_txid").default("0").notNull(),
  purgedAt: timestamp("purged_at", { withTimezone: true }),
});
