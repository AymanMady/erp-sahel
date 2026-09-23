/**
 * Moteur de synchronisation côté poste.
 *
 * Cycle complet (`SYNC_STRATEGY.md` §3) :
 *   1. vérifier que le serveur est **réellement** joignable ;
 *   2. vider l'outbox par lots, dans l'ordre causal ;
 *   3. appliquer les acquittements (numéro définitif, doublon, erreur, report) ;
 *   4. récupérer le delta serveur et rafraîchir le cache de lecture.
 *
 * Le moteur est **réentrant-safe** : un seul cycle à la fois, les déclenchements
 * concurrents (retour réseau + reprise de focus + minuteur) partagent le même.
 */

import type { SyncPushResponse } from "@shared/sync-protocol";
import { api } from "@/shared/api/http";
import { probeServer } from "@/shared/api/network";
import { getDeviceId } from "@/shared/auth/token-store";
import { ApiError } from "@/shared/api/api-error";
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
/** Taille de lot : assez grand pour être efficace, assez petit pour rester dans un POST. */
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
/** Délai avant la prochaine tentative après échec (backoff exponentiel plafonné). */
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

/** Recompte la file et publie l'état — appelé après chaque écriture hors ligne. */
export async function refreshCounters(): Promise<void> {
  const [pending, failed] = await Promise.all([countPending(), countFailed()]);
  emit({ pending, failed });
}

/** Envoie un lot et applique les acquittements. Renvoie le nombre d'opérations traitées. */
async function flushBatch(): Promise<{ processed: number; deferred: number }> {
  const batch = (await listPending(BATCH_SIZE)).slice(0, BATCH_SIZE);
  if (batch.length === 0) return { processed: 0, deferred: 0 };

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
      payload: record.payload,
    })),
  });

  let deferred = 0;
  for (const result of response.results) {
    if (result.status === "deferred") deferred += 1;
    await acknowledge({
      clientUuid: result.clientUuid,
      // `created` et `duplicate` sont deux succès : dans les deux cas le serveur
      // détient la donnée, c'est précisément la garantie d'idempotence ([BR-8]).
      status:
        result.status === "created" || result.status === "duplicate"
          ? "synced"
          : result.status === "deferred"
            ? "deferred"
            : "error",
      serverId: result.serverId ?? null,
      assignedNumber: result.assignedNumber ?? null,
      error: result.detail ?? null,
    });
  }

  // Une opération sans acquittement (réponse tronquée) revient en file d'attente.
  const acknowledged = new Set(response.results.map((result) => result.clientUuid));
  for (const record of batch) {
    if (!acknowledged.has(record.clientUuid)) {
      await acknowledge({ clientUuid: record.clientUuid, status: "pending" });
    }
  }

  await writeMeta(CURSOR_KEY, response.cursor);
  return { processed: batch.length, deferred };
}

/** Récupère le delta serveur depuis le dernier curseur connu. */
async function pullDelta(): Promise<void> {
  const cursor = await readMeta(CURSOR_KEY);
  if (!cursor) {
    // Pas de curseur : le poste n'a jamais synchronisé, un instantané complet
    // est à la fois plus simple et plus sûr qu'un delta sans point de départ.
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
 * Exécute un cycle complet. Ne lève jamais : un échec de synchronisation ne doit
 * pas interrompre la vente en cours.
 */
export async function runSync(options: { force?: boolean } = {}): Promise<SyncStatus> {
  if (runningCycle) return runningCycle;

  runningCycle = (async () => {
    if (!options.force && backoffMs > 0) {
      // Une tentative trop rapprochée après un échec n'apporte rien : on laisse
      // le minuteur de reprise faire son travail.
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
      // Boucle de vidage : on répète tant qu'il reste des opérations envoyables.
      // Les opérations « reportées » ne sont pas réessayées dans le même cycle —
      // leur dépendance ne pourrait pas avoir été résolue entre-temps.
      for (let round = 0; round < 20; round += 1) {
        const { processed, deferred } = await flushBatch();
        if (processed === 0 || deferred === processed) break;
      }

      await pullDelta();
      await purgeSynced();
      await refreshCounters();

      backoffMs = 0;
      const now = new Date().toISOString();
      await writeMeta("sync.lastSyncAt", now);
      emit({ state: "idle", lastSyncAt: now, lastError: null });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Échec de la synchronisation.";
      // Backoff exponentiel 2s → 4s → … → 60s (`SYNC_STRATEGY.md` §8).
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

/** Charge l'état initial au démarrage de l'application. */
export async function initialiseSyncStatus(): Promise<void> {
  const [lastSyncAt, snapshot] = await Promise.all([readMeta("sync.lastSyncAt"), readSnapshot()]);
  emit({
    lastSyncAt,
    state: snapshot ? "idle" : "offline",
  });
  await refreshCounters();
}
