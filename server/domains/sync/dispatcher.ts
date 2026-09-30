/**
 * Dispatcher of synchronizable entities.
 *
 * The sync engine does not know about domains: it knows an `entity → handler` table.
 * Adding a synchronizable entity (including from a module) therefore means registering
 * a handler, without touching the engine ([FR-PLUG-1]).
 */

import type { PermissionCode } from "@shared/rbac";
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
  /** When the operation was made on the device. */
  operationCreatedAt: Date;
  /** Whether the person may sell at another price than the catalog one. */
  canSetPrices: boolean;
  action: SyncAction;
  /** Row changed by an `update` or `delete`. */
  entityId?: string;
  /** Server version the change started from (`update`, `delete`). */
  baseVersion?: number | null;
}

export type SyncAction = "create" | "update" | "delete";

export interface SyncHandlerResult {
  serverId: string;
  /** Assigned legal number, to replace the provisional number on the client. */
  assignedNumber?: string;
}

export type SyncHandler = (
  context: SyncHandlerContext,
  payload: Record<string, unknown>
) => Promise<SyncHandlerResult>;

/**
 * A sensitive field changed on the server since the version the change started from:
 * the operation is refused as a whole and reported as a conflict, never applied over
 * the other change (`docs/OFFLINE_SYNC.md` §Conflicts).
 */
export class SyncConflictError extends Error {
  constructor(readonly fields: string[]) {
    super(tr("Changed meanwhile on the server: {fields}.", { fields: fields.join(", ") }));
    this.name = "SyncConflictError";
  }
}

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

/**
 * Permissions that allow an operation — the same ones as the online route it replays
 * (any one of them is enough). Working offline must never give more rights than
 * working online.
 */
export type SyncPermissionRule = (payload: Record<string, unknown>) => PermissionCode[];

interface RegisteredHandler {
  handler: SyncHandler;
  permissions: SyncPermissionRule;
}

class SyncDispatcher {
  private readonly handlers = new Map<string, RegisteredHandler>();

  /** One handler per entity and action; `create` unless said otherwise. */
  register(
    entity: SyncEntity | string,
    permissions: PermissionCode[] | SyncPermissionRule,
    handler: SyncHandler,
    action: SyncAction = "create"
  ): void {
    const key = `${entity}:${action}`;
    if (this.handlers.has(key)) {
      throw new Error(`Sync handler already registered for "${entity}" (${action}).`);
    }
    this.handlers.set(key, {
      handler,
      permissions: typeof permissions === "function" ? permissions : () => permissions,
    });
  }

  get(entity: string, action: SyncAction = "create"): RegisteredHandler | undefined {
    return this.handlers.get(`${entity}:${action}`);
  }

  /** Entities with a creation handler — what older workstations may send. */
  entities(): string[] {
    return [...this.handlers.keys()]
      .filter((key) => key.endsWith(":create"))
      .map((key) => key.slice(0, -":create".length));
  }
}

export const syncDispatcher = new SyncDispatcher();
