/**
 * Local IndexedDB database (Dexie) — offline persistence on the device.
 *
 * Three uses, and only three ([NFR-SEC-5]: minimal scope):
 *  1. `outbox` — operations created offline, waiting to be uploaded ([FR-SYNC-2]);
 *  2. `cache` — read snapshot (catalog, parties, stock) to keep selling without
 *     network ([FR-SYNC-1]);
 *  3. `meta` — synchronization cursor and local counters.
 *
 * IndexedDB survives closing the browser: this is what satisfies the requirement
 * "close then reopen → the data is still there" ([FR-SYNC-3], §16.3 of the spec).
 */

import Dexie, { type Table } from "dexie";

import type { SyncEntity } from "@shared/sync-protocol";

export type OutboxStatus = "pending" | "sending" | "synced" | "error" | "deferred";

/**
 * Any HTTP write queued offline and replayed as is (`offline-http.ts`) — for every
 * form without a dedicated synchronization operation. Device-local entity: it never
 * goes through `/api/sync/push`.
 */
export const HTTP_REQUEST_ENTITY = "http.request";

export type OutboxEntity = SyncEntity | typeof HTTP_REQUEST_ENTITY;

export interface OutboxRecord {
  /** Idempotency key generated on the device ([BR-8]). */
  clientUuid: string;
  /** Local monotonic counter: guarantees the causal order of replay (`SYNC_STRATEGY.md` §4). */
  localSeq: number;
  entity: OutboxEntity;
  action: "create" | "update";
  payload: Record<string, unknown>;
  /** `clientUuid` of the operations this one depends on. */
  dependsOn: string[];
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  /** Provisional number shown until the server assigns the final one. */
  provisionalNumber: string | null;
  /** Legal number returned by the server on acknowledgement. */
  assignedNumber: string | null;
  serverId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Readable summary for the "pending operations" screen. */
  label: string;
  amountCents: number | null;
}

export interface CacheRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface MetaRecord {
  key: string;
  value: string;
}

class ErpOfflineDatabase extends Dexie {
  outbox!: Table<OutboxRecord, string>;
  cache!: Table<CacheRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super("erp-sahel-offline");
    this.version(1).stores({
      outbox: "clientUuid, localSeq, status, entity, createdAt",
      cache: "key, updatedAt",
      meta: "key",
    });
  }
}

export const offlineDb = new ErpOfflineDatabase();

/**
 * True if IndexedDB is usable. In strict private browsing, or with storage blocked,
 * the app must remain functional **online** rather than crash.
 */
export async function isOfflineStorageAvailable(): Promise<boolean> {
  try {
    await offlineDb.open();
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks the browser for persistent storage: without it, the system may evict
 * IndexedDB under disk pressure — and unsynchronized sales along with it.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Full purge of local storage — on logout ([NFR-SEC-5]). */
export async function clearOfflineStorage(): Promise<void> {
  try {
    await offlineDb.transaction(
      "rw",
      offlineDb.outbox,
      offlineDb.cache,
      offlineDb.meta,
      async () => {
        await offlineDb.cache.clear();
        await offlineDb.meta.clear();
        // The outbox is **not** purged: unsynchronized sales must never
        // disappear because a user logged out.
      }
    );
  } catch {
    // Nothing to purge if storage is unavailable.
  }
}

export async function getMeta(key: string): Promise<string | null> {
  try {
    return (await offlineDb.meta.get(key))?.value ?? null;
  } catch {
    return null;
  }
}

export async function setMeta(key: string, value: string): Promise<void> {
  try {
    await offlineDb.meta.put({ key, value });
  } catch {
    // Storage unavailable: the value will simply be recomputed.
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const row = await offlineDb.cache.get(key);
    return (row?.value as T) ?? null;
  } catch {
    return null;
  }
}

export async function setCache(key: string, value: unknown): Promise<void> {
  try {
    await offlineDb.cache.put({ key, value, updatedAt: new Date().toISOString() });
  } catch {
    // Same: a missing cache degrades the offline experience without breaking the app.
  }
}
