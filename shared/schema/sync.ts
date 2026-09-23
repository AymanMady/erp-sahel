/**
 * Journal d'ingestion des opérations hors-ligne — garant de l'idempotence [BR-8].
 *
 * Chaque opération de l'outbox client porte un `client_uuid` généré sur le poste.
 * L'unicité de cette colonne est ce qui rend « rejouer le même lot » sans effet :
 * la deuxième ingestion renvoie `duplicate` + l'`server_id` déjà attribué, sans écrire.
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
    /** Clé d'idempotence fournie par le client. */
    clientUuid: uuid("client_uuid").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Entité ciblée, préfixée par domaine (`invoicing.sales_invoice`). */
    entity: text("entity").notNull(),
    action: text("action").default("create").notNull(),
    status: text("status").$type<SyncStatus>().notNull(),
    /** Identifiant serveur créé — sert à résoudre les références croisées d'un lot. */
    serverId: text("server_id").default("").notNull(),
    /** Numéro définitif attribué, renvoyé au client pour remplacer le provisoire. */
    assignedNumber: text("assigned_number").default("").notNull(),
    /** Ordre causal dans l'outbox du poste (`SYNC_STRATEGY.md` §4). */
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
 * Trace des postes synchronisés : dernier instantané servi, dernière remontée.
 * Sert au diagnostic terrain (« ce poste n'a pas synchronisé depuis 3 jours »).
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
