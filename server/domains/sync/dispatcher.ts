/**
 * Dispatcher of synchronizable entities.
 *
 * The sync engine does not know about domains: it knows an `entity → handler` table.
 * Adding a synchronizable entity (including from a module) therefore means registering
 * a handler, without touching the engine ([FR-PLUG-1]).
 */

import type { SyncEntity } from "@shared/sync-protocol";
import type { Company } from "@shared/schema";
import type { Database } from "../../db";
import { tr } from "../../shared/i18n";

/** Context passed to each ingestion handler. */
export interface SyncHandlerContext {
  tx: Database;
  company: Company;
  userId: string;
  /**
   * Idempotency key of the current operation.
   *
   * Entities that have a `client_uuid` column must fill it in: it links the document
   * to the provisional number shown on the device, and provides a second anti-duplicate
   * barrier at the database level (unique index), independent of the `sync_operations`
   * journal ([BR-8], `SYNC_STRATEGY.md` §5).
   */
  clientUuid: string;
  /**
   * Resolves the `clientUuid` of an entity created offline to its server id.
   * Throws `DeferredDependencyError` if the dependency has not been ingested yet — the
   * engine then postpones the operation to the next cycle instead of failing it.
   */
  resolveRef(clientUuid: string): Promise<string>;
}

export interface SyncHandlerResult {
  serverId: string;
  /** Assigned legal number, to replace the provisional number on the client. */
  assignedNumber?: string;
}

export type SyncHandler = (
  context: SyncHandlerContext,
  payload: Record<string, unknown>
) => Promise<SyncHandlerResult>;

/** Dependency not resolved yet: the operation is postponed, not rejected. */
export class DeferredDependencyError extends Error {
  constructor(readonly clientUuid: string) {
    super(
      tr("Dependency not synchronized yet ({clientUuid}): operation postponed to the next cycle.", {
        clientUuid,
      })
    );
    this.name = "DeferredDependencyError";
  }
}

class SyncDispatcher {
  private readonly handlers = new Map<string, SyncHandler>();

  register(entity: SyncEntity | string, handler: SyncHandler): void {
    if (this.handlers.has(entity)) {
      throw new Error(`Sync handler already registered for "${entity}".`);
    }
    this.handlers.set(entity, handler);
  }

  get(entity: string): SyncHandler | undefined {
    return this.handlers.get(entity);
  }

  entities(): string[] {
    return [...this.handlers.keys()];
  }
}

export const syncDispatcher = new SyncDispatcher();
