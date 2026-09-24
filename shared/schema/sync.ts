/**
 * Ingestion log of offline operations — the guarantor of idempotency [BR-8].
 *
 * Each operation of the client outbox carries a `client_uuid` generated on the workstation.
 * The uniqueness of this column is what makes "replaying the same batch" a no-op:
 * the second ingestion returns `duplicate` + the already assigned `server_id`, without writing.
 */

import {
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

export const SYNC_STATUSES = ["created", "duplicate", "error", "deferred"] as const;
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
    ...auditTimestamps,
  },
  (table) => [uniqueIndex("uq_sync_devices").on(table.companyId, table.deviceId)]
);

export type SyncDevice = typeof syncDevices.$inferSelect;
