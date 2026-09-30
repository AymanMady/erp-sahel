/**
 * Queue entry of a former-outbox record: same id (the idempotency key the server
 * knows), same order, same state. Used to move the former outbox into `sync_queue`,
 * and for every queueing while the offline-first mode is on.
 */

import { SYNC_ENTITY_TABLES, type SyncEntity } from "@shared/sync-protocol";
import { HTTP_REQUEST_ENTITY, type OutboxRecord } from "../db";
import type { QueueEntryInput, QueueOperation, QueueStatus } from "./local-db";

/** Queue operation of a former-outbox record. */
export function operationOf(
  record: Pick<OutboxRecord, "entity" | "action" | "payload">
): QueueOperation {
  if (record.entity === HTTP_REQUEST_ENTITY) {
    const method = String((record.payload as { method?: string }).method ?? "POST").toUpperCase();
    return method === "DELETE" ? "DELETE" : method === "POST" ? "CREATE" : "UPDATE";
  }
  return record.action === "update" ? "UPDATE" : "CREATE";
}

function statusOf(record: OutboxRecord): QueueStatus {
  if (record.status === "error") return "failed";
  if (record.status === "deferred") return "deferred";
  return "pending";
}

/** Queue entry of a former-outbox record, same id, order and state. */
export function queueEntryOf(record: OutboxRecord): QueueEntryInput {
  const table = SYNC_ENTITY_TABLES[record.entity as SyncEntity] ?? null;
  return {
    id: record.clientUuid,
    entity: record.entity,
    // A creation: the row does not exist here yet, the acknowledgement brings it.
    localTable: record.action === "update" ? table : null,
    entityId: null,
    operation: operationOf(record),
    payload: record.payload,
    dependsOn: record.dependsOn,
    label: record.label,
    seq: record.localSeq,
    status: statusOf(record),
    createdAt: record.createdAt,
  };
}
