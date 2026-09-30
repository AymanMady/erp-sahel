/**
 * Workstation → server: sends `sync_queue` (`docs/OFFLINE_SYNC.md` §Push).
 *
 * The same rules as the former outbox (`sync-engine.ts`), on the durable local queue:
 *  - causal order (`seq`); protocol operations go by batches to `/api/sync/push`,
 *    generic writes (`http.request`) are replayed one by one on their own endpoint;
 *  - every answer is stored with its effect on the local row in one transaction
 *    (`local_queue_ack`): accepted → the server row replaces the local one; conflict →
 *    both versions are kept for the person to choose; refused → kept, marked;
 *  - a network cut puts what was being sent back in the queue: the server recognizes
 *    an operation by its id, sending it again never creates a duplicate.
 */

import { outcomeOf, type SyncOperationResult, type SyncPushResponse } from "@shared/sync-protocol";
import { ApiError } from "@/shared/api/api-error";
import { api, apiRequest } from "@/shared/api/http";
import { getDeviceId } from "@/shared/auth/token-store";
import { HTTP_REQUEST_ENTITY, offlineDb, type OutboxStatus } from "../db";
import { replayRequest, substituteIds } from "../offline-http";
import { acknowledge } from "../outbox";
import { localDb, type Ack, type QueueRow } from "./local-db";

/** Batch size: large enough to be efficient, small enough to fit in a POST. */
const BATCH_SIZE = 50;

export interface PushSummary {
  succeeded: number;
  conflicts: number;
  failed: number;
  deferred: number;
  /** Generic writes replayed successfully. */
  replayedHttp: string[];
}

/** Next attempt after a server incident: 1 min, 2, 4… up to 30 min. */
function retryAt(retryCount: number): string {
  const delay = Math.min(30 * 60_000, 60_000 * 2 ** Math.min(retryCount, 10));
  return new Date(Date.now() + delay).toISOString();
}

/** Former-outbox status matching an acknowledgement, for the copy kept in IndexedDB. */
function mirrorStatus(status: Ack["status"]): OutboxStatus {
  if (status === "synced" || status === "deferred" || status === "pending") return status;
  return "error";
}

/** Stores an answer, and mirrors it on the IndexedDB copy the former screens read. */
async function acknowledgeLocal(ack: Ack): Promise<void> {
  await localDb.queueAck(ack);
  await acknowledge({
    clientUuid: ack.id,
    status: mirrorStatus(ack.status),
    serverId: ack.serverId ?? null,
    assignedNumber: ack.assignedNumber ?? null,
    error: ack.error ?? null,
  });
}

/**
 * Server ids of creations made through generic writes: the server gave them a new id,
 * that later writes naming the provisional one must use. Operations of the protocol
 * keep their id and need no mapping.
 */
async function httpServerIds(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const row of await localDb.queueList(["synced"], 5000)) {
    if (row.entity === HTTP_REQUEST_ENTITY && row.serverId)
      ids.set(row.id.toLowerCase(), row.serverId);
  }
  // Creations acknowledged before the local database existed (former outbox).
  try {
    const legacy = await offlineDb.outbox.filter((record) => !!record.serverId).toArray();
    for (const record of legacy) {
      if (record.entity === HTTP_REQUEST_ENTITY && !ids.has(record.clientUuid.toLowerCase())) {
        ids.set(record.clientUuid.toLowerCase(), record.serverId!);
      }
    }
  } catch {
    // No IndexedDB: nothing older to map.
  }
  return ids;
}

function ackOf(result: SyncOperationResult): Ack {
  const outcome = result.outcome ?? outcomeOf(result.status);
  const serverRow = result.record
    ? {
        entity: result.record.entity,
        id: result.record.id,
        version: result.record.version,
        data: result.record.data,
      }
    : null;
  switch (outcome) {
    case "success":
      return {
        id: result.clientUuid,
        status: "synced",
        serverId: result.serverId ?? null,
        assignedNumber: result.assignedNumber ?? null,
        serverRow,
      };
    case "conflict":
      return {
        id: result.clientUuid,
        status: "conflict",
        error: result.detail ?? null,
        serverRow,
        conflict: { fields: result.conflictFields ?? [] },
      };
    case "deferred":
      return { id: result.clientUuid, status: "deferred", error: result.detail ?? null };
    default:
      return { id: result.clientUuid, status: "failed", error: result.detail ?? null };
  }
}

async function sendBatch(batch: QueueRow[], ids: Map<string, string>, summary: PushSummary) {
  const response = await api.post<SyncPushResponse>("/api/sync/push", {
    deviceId: getDeviceId(),
    operations: batch.map((row) => ({
      clientUuid: row.id,
      localSeq: row.seq,
      entity: row.entity,
      action: row.operation.toLowerCase(),
      entityId: row.entityId ?? undefined,
      baseVersion: row.baseVersion,
      dependsOn: row.dependsOn,
      createdAt: row.createdAt,
      payload: substituteIds(row.payload, ids),
    })),
  });
  const answered = new Set<string>();
  for (const result of response.results) {
    answered.add(result.clientUuid);
    const ack = ackOf(result);
    await acknowledgeLocal(ack);
    if (ack.status === "synced") summary.succeeded += 1;
    else if (ack.status === "conflict") summary.conflicts += 1;
    else if (ack.status === "deferred") summary.deferred += 1;
    else summary.failed += 1;
  }
  // An operation without an answer (truncated response) goes back to the queue.
  for (const row of batch) {
    if (!answered.has(row.id)) await acknowledgeLocal({ id: row.id, status: "pending" });
  }
}

/**
 * Replays a generic write. A network failure stops the cycle (the error propagates);
 * a refusal of the server is stored on the operation.
 */
async function replayHttp(row: QueueRow, ids: Map<string, string>, summary: PushSummary) {
  const request = replayRequest({ clientUuid: row.id, payload: row.payload as never }, ids);
  try {
    const result = await apiRequest<unknown>(request.url, {
      method: request.method,
      body: request.body,
      idempotencyKey: request.idempotencyKey,
      queueOffline: false,
    });
    const id = (result as { id?: unknown } | null)?.id;
    const serverId = typeof id === "string" ? id : null;
    await acknowledgeLocal({ id: row.id, status: "synced", serverId });
    if (serverId) ids.set(row.id.toLowerCase(), serverId);
    summary.succeeded += 1;
    summary.replayedHttp.push(row.id);
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.isNetworkError ||
      error.status === 401 ||
      error.status === 429
    ) {
      await acknowledgeLocal({ id: row.id, status: "pending" });
      throw error;
    }
    // Deletion already done (replay after a lost answer): a success.
    if (request.method === "DELETE" && error.status === 404) {
      await acknowledgeLocal({ id: row.id, status: "synced" });
      summary.succeeded += 1;
      return;
    }
    if (error.status >= 500 || error.code === "IDEMPOTENCY_IN_PROGRESS") {
      await acknowledgeLocal({
        id: row.id,
        status: "pending",
        nextAttemptAt: retryAt(row.retryCount),
        error: error.code === "IDEMPOTENCY_IN_PROGRESS" ? null : error.message,
      });
      await localDb.log("warn", "push.retry", `${row.entity} ${error.status}`);
      return;
    }
    await acknowledgeLocal({ id: row.id, status: "failed", error: error.message });
    summary.failed += 1;
  }
}

/** Sends every operation due, in order. Throws on a network failure (cycle stopped). */
export async function pushLocalQueue(): Promise<PushSummary> {
  const summary: PushSummary = {
    succeeded: 0,
    conflicts: 0,
    failed: 0,
    deferred: 0,
    replayedHttp: [],
  };
  const ids = await httpServerIds();

  // Several passes only while deferred operations wait for others that went through.
  for (let pass = 0; pass < 3; pass += 1) {
    const rows = await localDb.queueReady(1000);
    if (rows.length === 0) break;
    const before = summary.succeeded;
    const deferredBefore = summary.deferred;

    let index = 0;
    while (index < rows.length) {
      const row = rows[index];
      if (row.entity === HTTP_REQUEST_ENTITY) {
        index += 1;
        await localDb.queueMarkSending([row.id]);
        await guard(() => replayHttp(row, ids, summary));
        continue;
      }
      const batch: QueueRow[] = [];
      while (
        index < rows.length &&
        rows[index].entity !== HTTP_REQUEST_ENTITY &&
        batch.length < BATCH_SIZE
      ) {
        batch.push(rows[index]);
        index += 1;
      }
      await localDb.queueMarkSending(batch.map((entry) => entry.id));
      await guard(() => sendBatch(batch, ids, summary));
    }

    const progressed = summary.succeeded > before;
    const deferred = summary.deferred > deferredBefore;
    if (!deferred || !progressed) break;
  }

  if (summary.succeeded + summary.conflicts + summary.failed > 0) {
    await localDb.log(
      summary.failed > 0 ? "warn" : "info",
      "push.completed",
      `sent ${summary.succeeded}, conflicts ${summary.conflicts}, refused ${summary.failed}, waiting ${summary.deferred}`
    );
  }
  return summary;
}

/**
 * A request that fails before its answer is stored leaves operations `sending`: they go
 * back to the queue at once, as after a crash.
 */
async function guard(send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
    await localDb.queueRecover();
    throw error;
  }
}
