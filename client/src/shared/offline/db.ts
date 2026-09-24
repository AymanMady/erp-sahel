/**
 * Base locale IndexedDB (Dexie) — persistance hors-ligne du poste.
 *
 * Trois usages, et seulement trois ([NFR-SEC-5] : périmètre minimal) :
 *  1. `outbox` — opérations créées hors ligne, en attente de remontée ([FR-SYNC-2]) ;
 *  2. `cache` — instantané de lecture (catalogue, tiers, stock) pour continuer à
 *     vendre sans réseau ([FR-SYNC-1]) ;
 *  3. `meta` — curseur de synchronisation et compteurs locaux.
 *
 * IndexedDB survit à la fermeture du navigateur : c'est ce qui satisfait l'exigence
 * « fermer puis rouvrir → les données sont toujours là » ([FR-SYNC-3], §16.3 CDC).
 */

import Dexie, { type Table } from "dexie";

import type { SyncEntity } from "@shared/sync-protocol";

export type OutboxStatus = "pending" | "sending" | "synced" | "error" | "deferred";

/**
 * Écriture HTTP quelconque mise en file hors ligne et rejouée telle quelle
 * (`offline-http.ts`) — pour tous les formulaires sans opération de synchronisation
 * dédiée. Entité locale au poste : elle ne transite jamais par `/api/sync/push`.
 */
export const HTTP_REQUEST_ENTITY = "http.request";

export type OutboxEntity = SyncEntity | typeof HTTP_REQUEST_ENTITY;

export interface OutboxRecord {
  /** Clé d'idempotence générée sur le poste ([BR-8]). */
  clientUuid: string;
  /** Compteur monotone local : garantit l'ordre causal du rejeu (`SYNC_STRATEGY.md` §4). */
  localSeq: number;
  entity: OutboxEntity;
  action: "create" | "update";
  payload: Record<string, unknown>;
  /** `clientUuid` des opérations dont celle-ci dépend. */
  dependsOn: string[];
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  /** Numéro provisoire affiché tant que le serveur n'a pas attribué le définitif. */
  provisionalNumber: string | null;
  /** Numéro légal renvoyé par le serveur à l'acquittement. */
  assignedNumber: string | null;
  serverId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Résumé lisible pour l'écran « opérations en attente ». */
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
 * Vrai si IndexedDB est utilisable. En navigation privée stricte, ou avec le stockage
 * bloqué, l'application doit rester fonctionnelle **en ligne** plutôt que de planter.
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
 * Demande la persistance du stockage au navigateur : sans elle, le système peut
 * évincer IndexedDB sous pression disque — et avec lui des ventes non synchronisées.
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

/** Purge complète du stockage local — à la déconnexion ([NFR-SEC-5]). */
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
        // L'outbox n'est **pas** purgée : des ventes non synchronisées ne doivent
        // jamais disparaître parce qu'un utilisateur s'est déconnecté.
      }
    );
  } catch {
    // Rien à purger si le stockage n'est pas disponible.
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
    // Stockage indisponible : la valeur sera simplement recalculée.
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
    // Idem : l'absence de cache dégrade l'expérience hors ligne, sans casser l'app.
  }
}
