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
import { ZodError } from "zod";

import { hasAnyPermission } from "@shared/rbac";
import type { Company, SyncOperation } from "@shared/schema";
import { runInTransaction } from "../../db";
import { AppError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { logger } from "../../shared/logging/logger";
import { canSetPrices } from "../auth/guards";
import { DeferredDependencyError, syncDispatcher } from "./dispatcher";
import { syncRepository } from "./repository";

export interface PushContext {
  company: Company;
  userId: string;
  deviceId: string;
  /** Rights of the person who pushes: checked on every operation. */
  isSuperuser: boolean;
  permissions: readonly string[];
}

/** Date of the operation on the device; a missing or unreadable one means "now". */
function operationDate(value: string | undefined): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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
    const existing = await syncRepository.findByClientUuid(
      context.company.id,
      operation.clientUuid
    );
    if (existing && (existing.status === "created" || existing.status === "duplicate")) {
      return this.duplicateOf(operation, existing, resolvedInBatch);
    }

    const registered = syncDispatcher.get(operation.entity);
    if (!registered) {
      return this.record(context, operation, {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "error",
        detail: tr('Entity "{entity}" is not supported by this server.', {
          entity: operation.entity,
        }),
      });
    }

    // 2. Same rights as the online route: working offline gives no extra power.
    const required = registered.permissions(operation.payload);
    if (!context.isSuperuser && !hasAnyPermission(context.permissions, required)) {
      return this.record(context, operation, {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "error",
        detail: tr("You do not have permission to perform this action."),
      });
    }

    // 3. Explicit dependencies declared by the client.
    const missing = await this.findMissingDependencies(
      context.company.id,
      operation.dependsOn,
      resolvedInBatch
    );
    if (missing) {
      return this.record(context, operation, {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "deferred",
        detail: tr("Waiting for {dependency} to be synchronized.", { dependency: missing }),
      });
    }

    // 4. Replay the business use case and write its journal row in the same transaction:
    //    either both exist, or neither does and the device simply sends it again.
    try {
      const outcome = await runInTransaction(async (tx) => {
        const repository = syncRepository.withTransaction(tx);
        // Two copies of the same operation arriving at once (two tabs, a retry while the
        // first request is still running): the second waits here, then sees the first.
        await repository.lockClientUuid(operation.clientUuid);
        const concurrent = await repository.findByClientUuid(
          context.company.id,
          operation.clientUuid
        );
        if (concurrent && (concurrent.status === "created" || concurrent.status === "duplicate")) {
          return { duplicateOf: concurrent as SyncOperation, result: undefined };
        }

        const result = await registered.handler(
          {
            tx,
            company: context.company,
            userId: context.userId,
            clientUuid: operation.clientUuid,
            operationCreatedAt: operationDate(operation.createdAt),
            canSetPrices: canSetPrices(context),
            resolveRef: async (clientUuid: string) => {
              const cached = resolvedInBatch.get(clientUuid);
              if (cached) return cached;
              const resolved = await repository.resolveServerIds(context.company.id, [clientUuid]);
              const serverId = resolved.get(clientUuid);
              if (!serverId) throw new DeferredDependencyError(clientUuid);
              resolvedInBatch.set(clientUuid, serverId);
              return serverId;
            },
          },
          operation.payload
        );
        await repository.record(
          this.journalRow(context, operation, {
            clientUuid: operation.clientUuid,
            entity: operation.entity,
            status: "created",
            serverId: result.serverId,
            assignedNumber: result.assignedNumber,
          })
        );
        return { duplicateOf: undefined, result };
      });

      if (outcome.duplicateOf) {
        return this.duplicateOf(operation, outcome.duplicateOf, resolvedInBatch);
      }
      const { result } = outcome;
      resolvedInBatch.set(operation.clientUuid, result.serverId);
      return {
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "created",
        serverId: result.serverId,
        assignedNumber: result.assignedNumber,
      };
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
          : error instanceof ZodError
            ? tr("The data sent is incomplete or invalid.")
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

  private duplicateOf(
    operation: SyncOperationInput,
    existing: SyncOperation,
    resolvedInBatch: Map<string, string>
  ): SyncOperationResult {
    if (existing.serverId) resolvedInBatch.set(operation.clientUuid, existing.serverId);
    return {
      clientUuid: operation.clientUuid,
      entity: operation.entity,
      status: "duplicate",
      serverId: existing.serverId || undefined,
      assignedNumber: existing.assignedNumber || undefined,
    };
  }

  private async findMissingDependencies(
    companyId: string,
    dependsOn: string[],
    resolvedInBatch: Map<string, string>
  ): Promise<string | null> {
    const unknown = dependsOn.filter((uuid) => !resolvedInBatch.has(uuid));
    if (unknown.length === 0) return null;
    const resolved = await syncRepository.resolveServerIds(companyId, unknown);
    for (const [clientUuid, serverId] of resolved) resolvedInBatch.set(clientUuid, serverId);
    const stillMissing = unknown.find((uuid) => !resolvedInBatch.has(uuid));
    return stillMissing ?? null;
  }

  private journalRow(
    context: PushContext,
    operation: SyncOperationInput,
    result: SyncOperationResult & { detail?: string }
  ) {
    return {
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
    };
  }

  /**
   * Records a result that did not go through the business transaction (rejection).
   * `deferred` statuses are **not** persisted: they must be replayable on the next
   * cycle.
   */
  private async record(
    context: PushContext,
    operation: SyncOperationInput,
    result: SyncOperationResult & { detail?: string }
  ): Promise<SyncOperationResult> {
    if (result.status !== "deferred") {
      await syncRepository.record(this.journalRow(context, operation, result));
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
