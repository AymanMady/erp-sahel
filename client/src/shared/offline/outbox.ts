/**
 * File d'attente des opérations créées hors ligne (« outbox pattern »).
 *
 * Invariants :
 *  - chaque opération porte un `clientUuid` **généré ici** : c'est la clé d'idempotence
 *    qui garantit qu'un rejeu ne crée jamais de doublon ([BR-8], [FR-SYNC-4]) ;
 *  - `localSeq` est un compteur monotone persistant : il fixe l'ordre causal du rejeu,
 *    de sorte qu'un règlement ne soit jamais envoyé avant sa facture ;
 *  - rien n'est supprimé avant acquittement du serveur.
 */

import type { SyncEntity } from "@shared/sync-protocol";
import { offlineDb, type OutboxRecord, type OutboxStatus } from "./db";
import { outboxStorage, readMeta, writeMeta } from "./storage";

/** Statuts qui restent à traiter : « envoyé » et « synchronisé » en sont exclus. */
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

/** Alloue le prochain numéro de séquence local (persistant entre deux sessions). */
async function nextLocalSeq(): Promise<number> {
  const current = Number.parseInt((await readMeta(SEQ_KEY)) ?? "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  await writeMeta(SEQ_KEY, String(next));
  return next;
}

export interface EnqueueInput {
  entity: SyncEntity;
  payload: Record<string, unknown>;
  dependsOn?: string[];
  /** Résumé affiché dans la file d'attente (« Ticket TKT-0003 — 4 500 MRU »). */
  label: string;
  amountCents?: number | null;
  provisionalNumber?: string | null;
  /** Permet au POS de pré-générer l'identifiant pour lier facture et règlement. */
  clientUuid?: string;
}

/** Ajoute une opération à la file et renvoie son `clientUuid`. */
export async function enqueue(input: EnqueueInput): Promise<OutboxRecord> {
  const now = new Date().toISOString();
  const record: OutboxRecord = {
    clientUuid: input.clientUuid ?? newUuid(),
    localSeq: await nextLocalSeq(),
    entity: input.entity,
    action: "create",
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

/** Opérations restant à envoyer, dans l'ordre causal. */
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
 * Acquitte une opération.
 * Une opération `deferred` **reste dans la file** : elle sera rejouée au cycle suivant,
 * une fois sa dépendance ingérée (`SYNC_STRATEGY.md` §4).
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
 * Purge les opérations acquittées de plus de N jours.
 * On les conserve un temps : elles portent la correspondance « numéro provisoire →
 * numéro définitif », utile à l'audit terrain après une coupure (`SYNC_STRATEGY.md` §6).
 */
export async function purgeSynced(olderThanDays = 7): Promise<number> {
  return outboxStorage().purgeSynced(olderThanDays);
}

/** Remet en file les opérations en erreur (bouton « Réessayer » de l'UI). */
export async function retryFailed(): Promise<number> {
  return offlineDb.outbox
    .where("status")
    .equals("error")
    .modify({ status: "pending", lastError: null, updatedAt: new Date().toISOString() });
}

/**
 * Abandonne définitivement une opération en erreur.
 * Réservé à une décision explicite de l'utilisateur : supprimer une vente non
 * synchronisée est une perte de donnée, jamais une action automatique.
 */
export async function discard(clientUuid: string): Promise<void> {
  await offlineDb.outbox.delete(clientUuid);
}

export { newUuid };
