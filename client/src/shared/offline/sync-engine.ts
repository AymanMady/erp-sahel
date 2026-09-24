/**
 * Moteur de synchronisation côté poste.
 *
 * Cycle complet (`SYNC_STRATEGY.md` §3) :
 *   1. vérifier que le serveur est **réellement** joignable ;
 *   2. vider l'outbox dans l'ordre causal : les opérations dédiées partent par lots vers
 *      `/api/sync/push`, les écritures génériques (`offline-http.ts`) sont rejouées
 *      une à une sur leur endpoint d'origine ;
 *   3. appliquer les acquittements (numéro définitif, doublon, erreur, report) ;
 *   4. récupérer le delta serveur et rafraîchir le cache de lecture.
 *
 * Le moteur est **réentrant-safe** : un seul cycle à la fois, les déclenchements
 * concurrents (retour réseau + reprise de focus + minuteur) partagent le même.
 */

import type { SyncPushResponse } from "@shared/sync-protocol";
import { api, apiRequest } from "@/shared/api/http";
import { probeServer } from "@/shared/api/network";
import { queryClient } from "@/shared/api/query-client";
import { getDeviceId } from "@/shared/auth/token-store";
import { ApiError } from "@/shared/api/api-error";
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

/**
 * Identifiants serveur des créations hors ligne déjà acquittées, indexés par
 * `clientUuid`. `all` sert à réécrire les écritures génériques ; `http` — les seules
 * créations que le serveur ne sait pas résoudre lui-même — sert aussi aux opérations
 * dédiées (une facture sur un magasin créé hors ligne).
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

/** Envoie un lot d'opérations dédiées et applique les acquittements. */
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
    // `created` et `duplicate` sont deux succès : dans les deux cas le serveur
    // détient la donnée, c'est précisément la garantie d'idempotence ([BR-8]).
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

  // Une opération sans acquittement (réponse tronquée) revient en file d'attente.
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
 * Rejoue une écriture générique. Une panne réseau interrompt le cycle (l'erreur
 * remonte) ; un refus du serveur est consigné sur l'opération.
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
    // Réseau, session expirée ou débit limité : rien n'est perdu, on réessaiera.
    if (
      !(error instanceof ApiError) ||
      error.isNetworkError ||
      error.status === 401 ||
      error.status === 429
    ) {
      await acknowledge({ clientUuid: record.clientUuid, status: "pending" });
      throw error;
    }
    // Suppression déjà faite (rejeu après une réponse perdue) : c'est un succès.
    if (request.method === "DELETE" && error.status === 404) {
      await acknowledge({ clientUuid: record.clientUuid, status: "synced" });
      return true;
    }
    // 4xx : refus métier, définitif tant que l'utilisateur n'a pas choisi de
    // réessayer. 5xx : incident serveur, retenté au cycle suivant.
    await acknowledge({
      clientUuid: record.clientUuid,
      status: error.status >= 500 ? "pending" : "error",
      error: error.message,
    });
    return false;
  }
}

/**
 * Vide l'outbox dans l'ordre causal. Renvoie les `clientUuid` des écritures
 * génériques rejouées avec succès.
 */
async function flushOutbox(): Promise<{ synced: number; replayedHttp: string[] }> {
  const maps = await knownServerIds();
  const replayedHttp: string[] = [];
  let synced = 0;

  // Plusieurs passes seulement si des opérations ont été reportées alors que
  // d'autres progressaient : leur dépendance a pu passer entre-temps.
  for (let pass = 0; pass < 3; pass += 1) {
    const pending = (await listPending(1000)).filter(
      // Une écriture générique refusée ne repart que sur « Réessayer ».
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
      const { synced, replayedHttp } = await flushOutbox();

      if (replayedHttp.length > 0) {
        // Les écritures génériques touchent aussi ce que le delta ne couvre pas
        // (catégories, magasins, modules…) : on repart d'un instantané complet, on
        // oublie les fiches provisoires, et on relance un préchargement complet.
        const snapshot = await pullSnapshot();
        await writeMeta(CURSOR_KEY, snapshot.cursor);
        await forgetCachedResponsesMentioning(replayedHttp);
        await writeMeta("prefetch.lastRunAt", "0");
      } else {
        await pullDelta();
      }
      await purgeSynced();
      await refreshCounters();
      // Les écrans affichent encore le reflet local des saisies : on les recharge.
      if (synced > 0) void queryClient.invalidateQueries();

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
