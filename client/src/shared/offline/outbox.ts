/**
 * Queue of operations created offline ("outbox pattern").
 *
 * Invariants:
 *  - each operation carries a `clientUuid` **generated here**: it is the idempotency key
 *    that guarantees a replay never creates a duplicate ([BR-8], [FR-SYNC-4]);
 *  - `localSeq` is a persistent monotonic counter: it sets the causal order of replay,
 *    so that a payment is never sent before its invoice;
 *  - nothing is deleted before the server acknowledges it.
 */

import { offlineDb, type OutboxEntity, type OutboxRecord, type OutboxStatus } from "./db";
import { outboxStorage, readMeta, writeMeta } from "./storage";

/** Statuses still to process: "sending" and "synced" are excluded. */
const PENDING_STATUSES: OutboxStatus[] = ["pending", "deferred", "error"];

const SEQ_KEY = "outbox.localSeq";

function newUuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-4000-8000-${Math.random()
      .toString(16)
      .slice(2, 14)}`
  );
}

/** Allocates the next local sequence number (persistent across sessions). */
async function nextLocalSeq(): Promise<number> {
  const current = Number.parseInt((await readMeta(SEQ_KEY)) ?? "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  await writeMeta(SEQ_KEY, String(next));
  return next;
}

export interface EnqueueInput {
  entity: OutboxEntity;
  payload: Record<string, unknown>;
  dependsOn?: string[];
  /** Summary shown in the queue ("Ticket TKT-0003 — 4,500 MRU"), already translated. */
  label: string;
  amountCents?: number | null;
  provisionalNumber?: string | null;
  /** Lets the POS pre-generate the identifier to link invoice and payment. */
  clientUuid?: string;
  action?: OutboxRecord["action"];
}

/** Adds an operation to the queue and returns its record. */
export async function enqueue(input: EnqueueInput): Promise<OutboxRecord> {
  const now = new Date().toISOString();
  const record: OutboxRecord = {
    clientUuid: input.clientUuid ?? newUuid(),
    localSeq: await nextLocalSeq(),
    entity: input.entity,
    action: input.action ?? "create",
    payload: input.payload,
    dependsOn: input.dependsOn ?? [],
    status: "pending",
    attempts: 0,
    lastError: null,
    provisionalNumber: input.provisionalNumber ?? null,
    assignedNumber: null,
    serverId: null,
    createdAt: now,
    updatedAt: now,
    label: input.label,
    amountCents: input.amountCents ?? null,
  };
  await outboxStorage().put(record);
  return record;
}

/** Operations still to send, in causal order. */
export async function listPending(limit = 200): Promise<OutboxRecord[]> {
  return outboxStorage().pending(limit);
}

export async function listAll(limit = 200): Promise<OutboxRecord[]> {
  return offlineDb.outbox.orderBy("localSeq").reverse().limit(limit).toArray();
}

export async function countPending(): Promise<number> {
  return offlineDb.outbox.where("status").anyOf(PENDING_STATUSES).count();
}

export async function countFailed(): Promise<number> {
  return offlineDb.outbox.where("status").equals("error").count();
}

export async function markSending(clientUuids: string[]): Promise<void> {
  await offlineDb.outbox
    .where("clientUuid")
    .anyOf(clientUuids)
    .modify({ status: "sending", updatedAt: new Date().toISOString() });
}

export interface AckInput {
  clientUuid: string;
  status: OutboxStatus;
  serverId?: string | null;
  assignedNumber?: string | null;
  error?: string | null;
}

/**
 * Acknowledges an operation.
 * A `deferred` operation **stays in the queue**: it will be replayed on the next cycle,
 * once its dependency has been ingested (`SYNC_STRATEGY.md` §4).
 */
export async function acknowledge(ack: AckInput): Promise<void> {
  const record = await offlineDb.outbox.get(ack.clientUuid);
  if (!record) return;
  await outboxStorage().mark(ack.clientUuid, {
    status: ack.status,
    serverId: ack.serverId ?? record.serverId,
    assignedNumber: ack.assignedNumber ?? record.assignedNumber,
    lastError: ack.error ?? null,
    attempts: ack.status === "synced" ? record.attempts : record.attempts + 1,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Purges operations acknowledged more than N days ago.
 * They are kept for a while: they hold the "provisional number → final number" mapping,
 * useful for field audits after an outage (`SYNC_STRATEGY.md` §6).
 */
export async function purgeSynced(olderThanDays = 7): Promise<number> {
  return outboxStorage().purgeSynced(olderThanDays);
}

/** Requeues failed operations (the UI's "Retry" button). */
export async function retryFailed(): Promise<number> {
  return offlineDb.outbox
    .where("status")
    .equals("error")
    .modify({ status: "pending", lastError: null, updatedAt: new Date().toISOString() });
}

/**
 * Permanently discards a failed operation.
 * Reserved for an explicit user decision: deleting an unsynchronized sale is data
 * loss, never an automatic action.
 */
export async function discard(clientUuid: string): Promise<void> {
  await offlineDb.outbox.delete(clientUuid);
}

export { newUuid };
