/**
 * Ingestion engine for the offline outbox.
 *
 * Key design choices:
 *  - **one transaction per operation**, not one per batch. If the fifth operation
 *    fails, the previous four stay acknowledged and will not be replayed; rejecting
 *    the whole batch would force the device to resend everything, and a permanent
 *    error on a single operation would block the queue forever;
 *  - **systematic logging** in `sync_operations`, failures included: this journal is
 *    what makes replays idempotent ([BR-8]) and serves as a field audit trail;
 *  - an unresolved dependency yields `deferred`, never `error`: the device will replay
 *    it on the next cycle, once the operation it depends on has gone through.
 *
 * `detail` messages are produced in the request language: they are both returned to
 * the device and stored in the journal for the supervision screen.
 */

import {
  sortOperations,
  type SyncOperationInput,
  type SyncOperationResult,
} from "@shared/sync-protocol";
import type { Company } from "@shared/schema";
import { runInTransaction } from "../../db";
import { AppError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
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
   * Ingests a batch. Operations are processed **sequentially** in causal order:
   * an invoice must see the customer created right before it.
   */
  async push(
    context: PushContext,
    operations: SyncOperationInput[]
  ): Promise<SyncOperationResult[]> {
    const results: SyncOperationResult[] = [];
    /** References resolved during this batch, to avoid one query per dependency. */
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
    // 1. Idempotency: an already-ingested operation writes nothing.
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
        detail: tr('Entity "{entity}" is not supported by this server.', {
          entity: operation.entity,
        }),
      });
    }

    // 2. Explicit dependencies declared by the client.
    const missing = await this.findMissingDependencies(operation.dependsOn, resolvedInBatch);
    if (missing) {
      return this.record(context, operation, {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "deferred",
        detail: tr("Waiting for {dependency} to be synchronized.", { dependency: missing }),
      });
    }

    // 3. Replay the business use case in its own transaction.
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
      // Constant `AppError` messages are English source text that the error handler
      // would normally translate; here they go into the result, so translate them now
      // (an already-translated message has no catalog entry and is returned unchanged).
      const detail =
        error instanceof AppError
          ? tr(error.message)
          : error instanceof Error
            ? error.message
            : tr("Unknown error during ingestion.");
      logger.warn("Sync operation rejected", {
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
   * Records the result. `deferred` statuses are **not** persisted: they must be
   * replayable on the next cycle, and a `sync_operations` row with this `client_uuid`
   * would block the second attempt on the unique constraint.
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
        // The payload of a rejected operation is kept for diagnostics; that of a
        // successful one is not (the data is already in the database).
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
