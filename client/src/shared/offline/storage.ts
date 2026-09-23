/**
 * Choix du support de persistance hors-ligne.
 *
 * Deux implémentations du **même contrat**, sélectionnées à l'exécution :
 *  - **IndexedDB** (Dexie) dans un navigateur : disponible partout, mais le système
 *    peut l'évincer sous pression disque ;
 *  - **SQLite** dans la coquille Tauri : un fichier du dossier applicatif, que rien
 *    n'évince — c'est ce qu'on veut sur un poste de caisse qui peut accumuler une
 *    journée de ventes non synchronisées.
 *
 * Le reste du code ignore lequel est actif : `outbox.ts` et `snapshot.ts` parlent à ce
 * module, jamais directement à Dexie ni à Tauri.
 */

import { isTauriDesktop, tauriInvoke } from "@/shared/desktop/desktop";
import { getCache, getMeta, offlineDb, setCache, setMeta, type OutboxRecord } from "./db";

export interface OutboxStorage {
  /** Nom du support, affiché dans l'écran de synchronisation. */
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

/** Ligne renvoyée par la commande Rust `offline_outbox_pending`. */
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
 * Support SQLite. Il **double** l'écriture dans IndexedDB : la webview lit vite depuis
 * Dexie pour l'affichage, tandis que SQLite garantit la survie des opérations si le
 * profil de la webview est réinitialisé.
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

    // IndexedDB vide alors que SQLite contient des opérations : le profil de la
    // webview a été réinitialisé. On restaure depuis le support durable.
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
 * Instantané de lecture. Dans la coquille desktop il est écrit dans les deux supports :
 * SQLite permet un démarrage hors ligne même après réinitialisation de la webview.
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

/** Vrai si une connexion hors ligne à froid est possible (desktop uniquement). */
export async function canLoginOffline(): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  return (await tauriInvoke<boolean>("offline_login_available")) ?? false;
}

/**
 * Vérifie un mot de passe contre l'instantané local.
 * Ne délivre aucun jeton d'API : l'accès au serveur reste impossible tant que le réseau
 * n'est pas revenu.
 */
export async function verifyOfflineLogin(username: string, password: string): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  return (await tauriInvoke<boolean>("offline_try_login", { username, password })) ?? false;
}
