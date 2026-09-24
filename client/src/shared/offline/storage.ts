/**
 * Choice of the offline persistence backend.
 *
 * Two implementations of the **same contract**, selected at runtime:
 *  - **IndexedDB** (Dexie) in a browser: available everywhere, but the system may evict
 *    it under disk pressure;
 *  - **SQLite** in the Tauri shell: a file in the application folder that nothing
 *    evicts — which is what we want on a POS terminal that may accumulate a whole day
 *    of unsynchronized sales.
 *
 * The rest of the code does not know which one is active: `outbox.ts` and `snapshot.ts`
 * talk to this module, never directly to Dexie or Tauri.
 */

import { isTauriDesktop, tauriInvoke } from "@/shared/desktop/desktop";
import { getCache, getMeta, offlineDb, setCache, setMeta, type OutboxRecord } from "./db";

export interface OutboxStorage {
  /** Backend name, shown on the synchronization screen. */
  readonly kind: "indexeddb" | "sqlite";
  put(record: OutboxRecord): Promise<void>;
  pending(limit: number): Promise<OutboxRecord[]>;
  mark(clientUuid: string, patch: Partial<OutboxRecord>): Promise<void>;
  purgeSynced(olderThanDays: number): Promise<number>;
}

const indexedDbStorage: OutboxStorage = {
  kind: "indexeddb",
  async put(record) {
    await offlineDb.outbox.put(record);
  },
  async pending(limit) {
    const rows = await offlineDb.outbox
      .where("status")
      .anyOf(["pending", "deferred", "error"])
      .toArray();
    return rows.sort((a, b) => a.localSeq - b.localSeq).slice(0, limit);
  },
  async mark(clientUuid, patch) {
    await offlineDb.outbox.update(clientUuid, patch);
  },
  async purgeSynced(olderThanDays) {
    const threshold = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const stale = await offlineDb.outbox
      .where("status")
      .equals("synced")
      .filter((record) => record.updatedAt < threshold)
      .toArray();
    await offlineDb.outbox.bulkDelete(stale.map((record) => record.clientUuid));
    return stale.length;
  },
};

/** Row returned by the Rust command `offline_outbox_pending`. */
interface SqliteOutboxRow {
  clientUuid: string;
  localSeq: number;
  entity: string;
  payload: string;
  dependsOn: string;
  status: string;
  attempts: number;
  lastError: string | null;
  label: string;
}

/**
 * SQLite backend. It **duplicates** the write into IndexedDB: the webview reads quickly
 * from Dexie for display, while SQLite guarantees the operations survive if the
 * webview profile is reset.
 */
const sqliteStorage: OutboxStorage = {
  kind: "sqlite",
  async put(record) {
    await indexedDbStorage.put(record);
    await tauriInvoke<void>("offline_outbox_enqueue", {
      clientUuid: record.clientUuid,
      localSeq: record.localSeq,
      entity: record.entity,
      payload: JSON.stringify(record.payload),
      dependsOn: JSON.stringify(record.dependsOn),
      label: record.label,
    });
  },

  async pending(limit) {
    const local = await indexedDbStorage.pending(limit);
    if (local.length > 0) return local;

    // IndexedDB empty while SQLite holds operations: the webview profile was reset.
    // Restore from the durable backend.
    const rows = await tauriInvoke<SqliteOutboxRow[]>("offline_outbox_pending", { limit });
    if (!rows || rows.length === 0) return [];

    const restored: OutboxRecord[] = rows.map((row) => ({
      clientUuid: row.clientUuid,
      localSeq: row.localSeq,
      entity: row.entity as OutboxRecord["entity"],
      action: "create",
      payload: safeParse(row.payload, {}) as Record<string, unknown>,
      dependsOn: safeParse(row.dependsOn, []) as string[],
      status: "pending",
      attempts: row.attempts,
      lastError: row.lastError,
      provisionalNumber: null,
      assignedNumber: null,
      serverId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      label: row.label,
      amountCents: null,
    }));

    await offlineDb.outbox.bulkPut(restored);
    return restored;
  },

  async mark(clientUuid, patch) {
    await indexedDbStorage.mark(clientUuid, patch);
    if (patch.status) {
      await tauriInvoke<void>("offline_outbox_mark", {
        clientUuid,
        status: patch.status,
        lastError: patch.lastError ?? null,
      });
    }
  },

  async purgeSynced(olderThanDays) {
    const removed = await indexedDbStorage.purgeSynced(olderThanDays);
    await tauriInvoke<number>("offline_outbox_purge", { olderThanDays });
    return removed;
  },
};

function safeParse(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function outboxStorage(): OutboxStorage {
  return isTauriDesktop() ? sqliteStorage : indexedDbStorage;
}

/**
 * Read snapshot. In the desktop shell it is written to both backends: SQLite allows an
 * offline start even after the webview has been reset.
 */
export async function writeSnapshotCache(key: string, value: unknown): Promise<void> {
  await setCache(key, value);
  if (isTauriDesktop()) {
    await tauriInvoke<void>("offline_cache_write", { key, value: JSON.stringify(value) });
  }
}

export async function readSnapshotCache<T>(key: string): Promise<T | null> {
  const local = await getCache<T>(key);
  if (local) return local;
  if (!isTauriDesktop()) return null;

  const raw = await tauriInvoke<string | null>("offline_cache_read", { key });
  if (!raw) return null;
  const restored = safeParse(raw, null) as T | null;
  if (restored) await setCache(key, restored);
  return restored;
}

export async function writeMeta(key: string, value: string): Promise<void> {
  await setMeta(key, value);
  if (isTauriDesktop()) {
    await tauriInvoke<void>("offline_cache_write", { key: `meta:${key}`, value });
  }
}

export async function readMeta(key: string): Promise<string | null> {
  const local = await getMeta(key);
  if (local) return local;
  if (!isTauriDesktop()) return null;
  return tauriInvoke<string | null>("offline_cache_read", { key: `meta:${key}` });
}

/** True if a cold offline login is possible (desktop only). */
export async function canLoginOffline(): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  return (await tauriInvoke<boolean>("offline_login_available")) ?? false;
}

/**
 * Checks a password against the local snapshot.
 * Issues no API token: server access remains impossible until the network is back.
 */
export async function verifyOfflineLogin(username: string, password: string): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  return (await tauriInvoke<boolean>("offline_try_login", { username, password })) ?? false;
}
