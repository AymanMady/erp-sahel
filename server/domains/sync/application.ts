/**
 * Moteur d'ingestion de l'outbox hors-ligne.
 *
 * Choix structurants :
 *  - **une transaction par opération**, pas une par lot. Si la cinquième opération
 *    échoue, les quatre précédentes restent acquittées et ne seront pas rejouées ;
 *    un lot entièrement rejeté obligerait le poste à tout renvoyer, et une erreur
 *    permanente sur une seule opération bloquerait indéfiniment la file ;
 *  - **journalisation systématique** dans `sync_operations`, y compris pour les
 *    échecs : c'est ce journal qui rend les rejeux idempotents ([BR-8]) et qui sert
 *    de piste d'audit terrain ;
 *  - une dépendance non résolue donne `deferred`, jamais `error` : le poste rejouera
 *    au cycle suivant, quand l'opération dont elle dépend sera passée.
 */

import {
  sortOperations,
  type SyncOperationInput,
  type SyncOperationResult,
} from "@shared/sync-protocol";
import type { Company } from "@shared/schema";
import { runInTransaction } from "../../db";
import { AppError } from "../../shared/errors/app-error";
import { logger } from "../../shared/logging/logger";
import { DeferredDependencyError, syncDispatcher } from "./dispatcher";
import { syncRepository } from "./repository";

export interface PushContext {
  company: Company;
  userId: string;
  deviceId: string;
}

class SyncApplication {
  /**
   * Ingère un lot. Les opérations sont traitées **séquentiellement** dans l'ordre
   * causal : une facture doit voir le client créé juste avant elle.
   */
  async push(
    context: PushContext,
    operations: SyncOperationInput[]
  ): Promise<SyncOperationResult[]> {
    const results: SyncOperationResult[] = [];
    /** Références résolues durant ce lot, pour éviter une requête par dépendance. */
    const resolvedInBatch = new Map<string, string>();

    for (const operation of sortOperations(operations)) {
      results.push(await this.ingestOne(context, operation, resolvedInBatch));
    }

    await syncRepository.touchDevice({
      companyId: context.company.id,
      deviceId: context.deviceId,
      userId: context.userId,
      push: true,
    });

    return results;
  }

  private async ingestOne(
    context: PushContext,
    operation: SyncOperationInput,
    resolvedInBatch: Map<string, string>
  ): Promise<SyncOperationResult> {
    // 1. Idempotence : une opération déjà ingérée ne réécrit rien.
    const existing = await syncRepository.findByClientUuid(operation.clientUuid);
    if (existing && (existing.status === "created" || existing.status === "duplicate")) {
      if (existing.serverId) resolvedInBatch.set(operation.clientUuid, existing.serverId);
      return {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "duplicate",
        serverId: existing.serverId || undefined,
        assignedNumber: existing.assignedNumber || undefined,
      };
    }

    const handler = syncDispatcher.get(operation.entity);
    if (!handler) {
      return this.record(context, operation, {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "error",
        detail: `Entité « ${operation.entity} » non prise en charge par ce serveur.`,
      });
    }

    // 2. Dépendances explicites déclarées par le client.
    const missing = await this.findMissingDependencies(operation.dependsOn, resolvedInBatch);
    if (missing) {
      return this.record(context, operation, {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "deferred",
        detail: `En attente de la synchronisation de ${missing}.`,
      });
    }

    // 3. Rejeu du cas d'usage métier dans sa propre transaction.
    try {
      const outcome = await runInTransaction(async (tx) =>
        handler(
          {
            tx,
            company: context.company,
            userId: context.userId,
            clientUuid: operation.clientUuid,
            resolveRef: async (clientUuid: string) => {
              const cached = resolvedInBatch.get(clientUuid);
              if (cached) return cached;
              const resolved = await syncRepository.resolveServerIds([clientUuid]);
              const serverId = resolved.get(clientUuid);
              if (!serverId) throw new DeferredDependencyError(clientUuid);
              resolvedInBatch.set(clientUuid, serverId);
              return serverId;
            },
          },
          operation.payload
        )
      );

      resolvedInBatch.set(operation.clientUuid, outcome.serverId);
      return this.record(context, operation, {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "created",
        serverId: outcome.serverId,
        assignedNumber: outcome.assignedNumber,
      });
    } catch (error) {
      if (error instanceof DeferredDependencyError) {
        return this.record(context, operation, {
          clientUuid: operation.clientUuid,
          entity: operation.entity,
          status: "deferred",
          detail: error.message,
        });
      }
      const detail =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Erreur inconnue à l'ingestion.";
      logger.warn("Opération de synchronisation refusée", {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        deviceId: context.deviceId,
        detail,
      });
      return this.record(context, operation, {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "error",
        detail,
      });
    }
  }

  private async findMissingDependencies(
    dependsOn: string[],
    resolvedInBatch: Map<string, string>
  ): Promise<string | null> {
    const unknown = dependsOn.filter((uuid) => !resolvedInBatch.has(uuid));
    if (unknown.length === 0) return null;
    const resolved = await syncRepository.resolveServerIds(unknown);
    for (const [clientUuid, serverId] of resolved) resolvedInBatch.set(clientUuid, serverId);
    const stillMissing = unknown.find((uuid) => !resolvedInBatch.has(uuid));
    return stillMissing ?? null;
  }

  /**
   * Journalise le résultat. Les statuts `deferred` ne sont **pas** persistés : ils
   * doivent pouvoir être rejoués au cycle suivant, et une ligne `sync_operations`
   * avec ce `client_uuid` bloquerait la seconde tentative sur la contrainte d'unicité.
   */
  private async record(
    context: PushContext,
    operation: SyncOperationInput,
    result: SyncOperationResult & { detail?: string }
  ): Promise<SyncOperationResult> {
    if (result.status !== "deferred") {
      await syncRepository.record({
        clientUuid: operation.clientUuid,
        companyId: context.company.id,
        userId: context.userId,
        entity: operation.entity,
        action: operation.action,
        status: result.status,
        serverId: result.serverId ?? "",
        assignedNumber: result.assignedNumber ?? "",
        localSeq: operation.localSeq,
        deviceId: context.deviceId,
        detail: result.detail ?? "",
        // Le payload d'une opération refusée est conservé pour le diagnostic ;
        // celui d'une opération réussie ne l'est pas (la donnée est déjà en base).
        payload: result.status === "error" ? operation.payload : null,
      });
    }
    return result;
  }

  async stats(companyId: string) {
    return syncRepository.stats(companyId);
  }

  async listDevices(companyId: string) {
    return syncRepository.listDevices(companyId);
  }

  async listRecent(companyId: string, limit = 100) {
    return syncRepository.listRecent(companyId, limit);
  }
}

export const syncApplication = new SyncApplication();
