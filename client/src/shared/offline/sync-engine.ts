/**
 * Device-side synchronization engine.
 *
 * Full cycle (`SYNC_STRATEGY.md` §3):
 *   1. check that the server is **really** reachable;
 *   2. drain the outbox in causal order: dedicated operations are sent in batches to
 *      `/api/sync/push`, generic writes (`offline-http.ts`) are replayed one by one on
 *      their original endpoint;
 *   3. apply the acknowledgements (final number, duplicate, error, deferral);
 *   4. fetch the server delta and refresh the read cache.
 *
 * The engine is **reentrancy-safe**: only one cycle at a time, concurrent triggers
 * (network back + focus regained + timer) share the same one.
 */

import type { SyncPushResponse } from "@shared/sync-protocol";
import { api, apiRequest } from "@/shared/api/http";
import { probeServer } from "@/shared/api/network";
import { queryClient } from "@/shared/api/query-client";
import { getDeviceId } from "@/shared/auth/token-store";
import { ApiError } from "@/shared/api/api-error";
import { i18n } from "@/shared/i18n";
import { HTTP_REQUEST_ENTITY, offlineDb, type OutboxRecord } from "./db";
import { forgetCachedResponsesMentioning } from "./http-cache";
import { replayRequest, substituteIds } from "./offline-http";
import { readMeta, writeMeta } from "./storage";
import {
  acknowledge,
  countFailed,
  countPending,
  listPending,
  markSending,
  purgeSynced,
} from "./outbox";
import { applyDelta, pullSnapshot, readSnapshot } from "./snapshot";

const CURSOR_KEY = "sync.cursor";
/** Batch size: large enough to be efficient, small enough to fit in a POST. */
const BATCH_SIZE = 50;

export type SyncState = "idle" | "offline" | "syncing" | "error";

export interface SyncStatus {
  state: SyncState;
  pending: number;
  failed: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

let current: SyncStatus = {
  state: "idle",
  pending: 0,
  failed: 0,
  lastSyncAt: null,
  lastError: null,
};

const listeners = new Set<(status: SyncStatus) => void>();
let runningCycle: Promise<SyncStatus> | null = null;
/** Delay before the next attempt after a failure (capped exponential backoff). */
let backoffMs = 0;

function emit(patch: Partial<SyncStatus>): void {
  current = { ...current, ...patch };
  for (const listener of listeners) listener(current);
}

export function getSyncStatus(): SyncStatus {
  return current;
}

export function onSyncStatusChange(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/** Recounts the queue and publishes the state — called after each offline write. */
export async function refreshCounters(): Promise<void> {
  const [pending, failed] = await Promise.all([countPending(), countFailed()]);
  emit({ pending, failed });
}

/**
 * Server identifiers of offline creations already acknowledged, keyed by `clientUuid`.
 * `all` is used to rewrite generic writes; `http` — the only creations the server
 * cannot resolve on its own — is also used for dedicated operations (an invoice on a
 * warehouse created offline).
 */
interface IdMaps {
  all: Map<string, string>;
  http: Map<string, string>;
}

async function knownServerIds(): Promise<IdMaps> {
  const maps: IdMaps = { all: new Map(), http: new Map() };
  const rows = await offlineDb.outbox.filter((record) => !!record.serverId).toArray();
  for (const record of rows) remember(maps, record, record.serverId);
  return maps;
}

function remember(maps: IdMaps, record: OutboxRecord, serverId: string | null | undefined) {
  if (!serverId) return;
  maps.all.set(record.clientUuid.toLowerCase(), serverId);
  if (record.entity === HTTP_REQUEST_ENTITY)
    maps.http.set(record.clientUuid.toLowerCase(), serverId);
}

/** Sends a batch of dedicated operations and applies the acknowledgements. */
async function pushBatch(
  batch: OutboxRecord[],
  maps: IdMaps
): Promise<{ synced: number; deferred: number }> {
  await markSending(batch.map((record) => record.clientUuid));

  const response = await api.post<SyncPushResponse>("/api/sync/push", {
    deviceId: getDeviceId(),
    operations: batch.map((record) => ({
      clientUuid: record.clientUuid,
      localSeq: record.localSeq,
      entity: record.entity,
      action: record.action,
      dependsOn: record.dependsOn,
      createdAt: record.createdAt,
      payload: substituteIds(record.payload, maps.http),
    })),
  });

  let deferred = 0;
  let synced = 0;
  for (const result of response.results) {
    if (result.status === "deferred") deferred += 1;
    // `created` and `duplicate` are both successes: in both cases the server holds
    // the data, which is precisely the idempotency guarantee ([BR-8]).
    const ok = result.status === "created" || result.status === "duplicate";
    if (ok) synced += 1;
    await acknowledge({
      clientUuid: result.clientUuid,
      status: ok ? "synced" : result.status === "deferred" ? "deferred" : "error",
      serverId: result.serverId ?? null,
      assignedNumber: result.assignedNumber ?? null,
      error: result.detail ?? null,
    });
    const record = batch.find((row) => row.clientUuid === result.clientUuid);
    if (ok && record) remember(maps, record, result.serverId);
  }

  // An operation without acknowledgement (truncated response) goes back to the queue.
  const acknowledged = new Set(response.results.map((result) => result.clientUuid));
  for (const record of batch) {
    if (!acknowledged.has(record.clientUuid)) {
      await acknowledge({ clientUuid: record.clientUuid, status: "pending" });
    }
  }

  await writeMeta(CURSOR_KEY, response.cursor);
  return { synced, deferred };
}

/**
 * Replays a generic write. A network failure interrupts the cycle (the error
 * propagates); a server rejection is recorded on the operation.
 */
async function replayHttp(record: OutboxRecord, maps: IdMaps): Promise<boolean> {
  const request = replayRequest(record, maps.all);
  await markSending([record.clientUuid]);
  try {
    const result = await apiRequest<unknown>(request.url, {
      method: request.method,
      body: request.body,
      idempotencyKey: request.idempotencyKey,
      queueOffline: false,
    });
    const id = (result as { id?: unknown } | null)?.id;
    const serverId = typeof id === "string" ? id : null;
    await acknowledge({ clientUuid: record.clientUuid, status: "synced", serverId });
    remember(maps, record, serverId);
    return true;
  } catch (error) {
    // Network, expired session or rate limit: nothing is lost, we will retry.
    if (
      !(error instanceof ApiError) ||
      error.isNetworkError ||
      error.status === 401 ||
      error.status === 429
    ) {
      await acknowledge({ clientUuid: record.clientUuid, status: "pending" });
      throw error;
    }
    // Deletion already done (replay after a lost response): it is a success.
    if (request.method === "DELETE" && error.status === 404) {
      await acknowledge({ clientUuid: record.clientUuid, status: "synced" });
      return true;
    }
    // 4xx: business rejection, final until the user chooses to retry.
    // 5xx: server incident, retried on the next cycle.
    await acknowledge({
      clientUuid: record.clientUuid,
      status: error.status >= 500 ? "pending" : "error",
      error: error.message,
    });
    return false;
  }
}

/**
 * Drains the outbox in causal order. Returns the `clientUuid`s of the generic writes
 * replayed successfully.
 */
async function flushOutbox(): Promise<{ synced: number; replayedHttp: string[] }> {
  const maps = await knownServerIds();
  const replayedHttp: string[] = [];
  let synced = 0;

  // Several passes only if operations were deferred while others progressed: their
  // dependency may have gone through in the meantime.
  for (let pass = 0; pass < 3; pass += 1) {
    const pending = (await listPending(1000)).filter(
      // A rejected generic write is only resent on "Retry".
      (record) => !(record.entity === HTTP_REQUEST_ENTITY && record.status === "error")
    );
    if (pending.length === 0) break;

    let progressed = 0;
    let deferred = 0;
    let index = 0;
    while (index < pending.length) {
      const record = pending[index];
      if (record.entity === HTTP_REQUEST_ENTITY) {
        index += 1;
        if (await replayHttp(record, maps)) {
          progressed += 1;
          replayedHttp.push(record.clientUuid);
        }
        continue;
      }
      const batch: OutboxRecord[] = [];
      while (
        index < pending.length &&
        pending[index].entity !== HTTP_REQUEST_ENTITY &&
        batch.length < BATCH_SIZE
      ) {
        batch.push(pending[index]);
        index += 1;
      }
      const result = await pushBatch(batch, maps);
      progressed += result.synced;
      deferred += result.deferred;
    }

    synced += progressed;
    if (deferred === 0 || progressed === 0) break;
  }

  return { synced, replayedHttp };
}

/** Fetches the server delta since the last known cursor. */
async function pullDelta(): Promise<void> {
  const cursor = await readMeta(CURSOR_KEY);
  if (!cursor) {
    // No cursor: the device has never synchronized, a full snapshot is both simpler
    // and safer than a delta without a starting point.
    const snapshot = await pullSnapshot();
    await writeMeta(CURSOR_KEY, snapshot.cursor);
    return;
  }
  const delta = await api.get<Parameters<typeof applyDelta>[0]>("/api/sync/pull", {
    since: cursor,
  });
  await applyDelta(delta);
  await writeMeta(CURSOR_KEY, delta.cursor);
}

/**
 * Runs a full cycle. Never throws: a synchronization failure must not interrupt the
 * sale in progress.
 */
export async function runSync(options: { force?: boolean } = {}): Promise<SyncStatus> {
  if (runningCycle) return runningCycle;

  runningCycle = (async () => {
    if (!options.force && backoffMs > 0) {
      // An attempt too soon after a failure achieves nothing: let the retry timer do
      // its job.
      return current;
    }

    const reachable = await probeServer(true);
    if (!reachable) {
      emit({ state: "offline" });
      await refreshCounters();
      return current;
    }

    emit({ state: "syncing", lastError: null });
    try {
      const { synced, replayedHttp } = await flushOutbox();

      if (replayedHttp.length > 0) {
        // Generic writes also touch what the delta does not cover (categories,
        // warehouses, modules…): start again from a full snapshot, forget the
        // provisional details, and trigger a full prefetch.
        const snapshot = await pullSnapshot();
        await writeMeta(CURSOR_KEY, snapshot.cursor);
        await forgetCachedResponsesMentioning(replayedHttp);
        await writeMeta("prefetch.lastRunAt", "0");
      } else {
        await pullDelta();
      }
      await purgeSynced();
      await refreshCounters();
      // Screens still show the local reflection of the entries: reload them.
      if (synced > 0) void queryClient.invalidateQueries();

      backoffMs = 0;
      const now = new Date().toISOString();
      await writeMeta("sync.lastSyncAt", now);
      emit({ state: "idle", lastSyncAt: now, lastError: null });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : i18n.t("offline:sync.failed");
      // Exponential backoff 2s → 4s → … → 60s (`SYNC_STRATEGY.md` §8).
      backoffMs = Math.min(60_000, backoffMs === 0 ? 2000 : backoffMs * 2);
      setTimeout(() => {
        backoffMs = 0;
      }, backoffMs);
      await refreshCounters();
      emit({
        state: error instanceof ApiError && error.isNetworkError ? "offline" : "error",
        lastError: message,
      });
    }
    return current;
  })();

  try {
    return await runningCycle;
  } finally {
    runningCycle = null;
  }
}

/** Loads the initial state at application startup. */
export async function initialiseSyncStatus(): Promise<void> {
  const [lastSyncAt, snapshot] = await Promise.all([readMeta("sync.lastSyncAt"), readSnapshot()]);
  emit({
    lastSyncAt,
    state: snapshot ? "idle" : "offline",
  });
  await refreshCounters();
}
