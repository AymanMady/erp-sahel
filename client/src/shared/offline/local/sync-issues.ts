/**
 * What needs a person's decision on the offline-first desktop: **conflicts** (a change
 * made here met another change of the same sensitive field on the server) and
 * **refused operations** (the server said no: invalid data, missing right…).
 *
 * Nothing is settled silently: the local version stays on screen until the person
 * chooses (`docs/OFFLINE_SYNC.md` §Conflicts).
 */

import type { SyncEntity, SyncTable } from "@shared/sync-protocol";
import { newUuid } from "../outbox";
import { localDb, type ConflictRow, type QueueRow } from "./local-db";
import { refreshReadiness } from "./replication";

/** Protocol entity of the reference data whose changes can conflict. */
const PROTOCOL_OF: Partial<Record<SyncTable, SyncEntity>> = {
  products: "catalog.product",
  parties: "core.party",
  categories: "catalog.category",
  services: "services.service",
};

export interface SyncIssues {
  conflicts: ConflictRow[];
  refused: QueueRow[];
}

export async function listSyncIssues(): Promise<SyncIssues> {
  const [conflicts, refused] = await Promise.all([
    localDb.conflictsOpen(),
    localDb.queueList(["failed"], 200),
  ]);
  return { conflicts, refused };
}

/**
 * Settles a conflict.
 *  - `keep_server`: the server version is shown, the local change is dropped;
 *  - `keep_local`: the local change is sent again, this time on the server version —
 *    a deliberate choice, so it is applied.
 */
export async function resolveConflict(
  conflict: ConflictRow,
  choice: "keep_local" | "keep_server"
): Promise<void> {
  if (choice === "keep_server") {
    await localDb.conflictResolve(conflict.id, "keep_server");
  } else {
    const local = (conflict.localPayload ?? {}) as { changes?: Record<string, unknown> };
    const changes = local.changes ?? {};
    const server = conflict.serverData ?? {};
    const protocol = PROTOCOL_OF[conflict.entity];
    if (!protocol || !conflict.entityId) throw new Error(`Cannot send ${conflict.entity} again.`);
    await localDb.conflictResolve(conflict.id, "keep_local", {
      id: newUuid(),
      entity: protocol,
      localTable: conflict.entity,
      entityId: conflict.entityId,
      operation: "UPDATE",
      payload: {
        changes,
        base: Object.fromEntries(
          Object.keys(changes).map((field) => [field, server[field] ?? null])
        ),
      },
      baseVersion: conflict.serverVersion,
    });
  }
  await localDb.log("info", "conflict.resolved", `${conflict.entity} ${choice}`);
}

/** "Retry" on a refused operation: back to the queue for the next cycle. */
export async function retryOperation(id: string): Promise<void> {
  await localDb.queueRetry(id);
}

/**
 * Gives up a refused operation (explicit decision: a sale or a change is lost). A row
 * whose change is dropped is downloaded again, so the screen shows the server's data.
 */
export async function discardOperation(id: string): Promise<void> {
  const reload = await localDb.queueDiscard(id);
  if (reload) {
    await localDb.apply({ progress: { entity: reload, afterId: null, rows: 0, done: false } });
    await refreshReadiness();
  }
  await localDb.log("warn", "operation.discarded", id);
}
