/**
 * Replication to offline-first workstations: first synchronization (bootstrap) and
 * incremental pull (`docs/OFFLINE_SYNC.md`).
 *
 * **When the cursor is taken.** The bootstrap cursor is read *before* the first page:
 * every change committed after it is served again by the pull that follows the
 * bootstrap. A row changed while its page downloads is therefore sent twice at worst —
 * never missed — and the workstation keeps the higher version. A row deleted meanwhile
 * comes through the pull as a `DELETE`.
 */

import { format, subMonths } from "date-fns";

import {
  BOOTSTRAP_HISTORY_MONTHS,
  type BootstrapPageResponse,
  type BootstrapStartResponse,
  type PullChange,
  type PullResponse,
  type SyncTable,
} from "@shared/sync-protocol";
import { db } from "../../db";
import { ForbiddenError } from "../../shared/errors/app-error";
import { logger } from "../../shared/logging/logger";
import { moduleRegistry } from "../plugins/registry";
import { syncChangesRepository } from "./changes";
import {
  countRows,
  loadRecords,
  pageIds,
  readableEntities,
  syncEntity,
  type SyncEntityDefinition,
} from "./entities";

export interface ReplicationContext {
  companyId: string;
  userId: string;
  isSuperuser: boolean;
  permissions: readonly string[];
}

/** Log rows older than this are purged; a workstation away longer downloads again. */
const CHANGE_LOG_RETENTION_DAYS = 30;
/** At most one purge per server process per hour: it runs on the side of a pull. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastPurgeAt = 0;

async function scope(context: ReplicationContext): Promise<SyncEntityDefinition[]> {
  const enabledModules = await moduleRegistry.enabledCodes(context.companyId);
  return readableEntities({
    isSuperuser: context.isSuperuser,
    permissions: context.permissions,
    enabledModules,
  });
}

function defaultSince(): string {
  return format(subMonths(new Date(), BOOTSTRAP_HISTORY_MONTHS), "yyyy-MM-dd");
}

class ReplicationApplication {
  async bootstrapStart(context: ReplicationContext): Promise<BootstrapStartResponse> {
    // First: anything committed from now on is covered by the pull after the bootstrap.
    const cursor = await syncChangesRepository.currentCursor();
    const since = defaultSince();
    const entities = [];
    for (const definition of await scope(context)) {
      entities.push({
        entity: definition.name,
        total: await countRows(db, definition, { companyId: context.companyId, since }),
      });
    }
    logger.info("Sync bootstrap started", {
      companyId: context.companyId,
      userId: context.userId,
      cursor,
      entities: entities.length,
    });
    return { cursor, since, entities };
  }

  async bootstrapPage(
    context: ReplicationContext,
    entity: SyncTable,
    input: { after?: string; limit: number; since?: string }
  ): Promise<BootstrapPageResponse> {
    const definition = (await scope(context)).find((candidate) => candidate.name === entity);
    if (!definition) throw new ForbiddenError("You do not have permission to perform this action.");

    const ids = await pageIds(db, definition, {
      companyId: context.companyId,
      after: input.after,
      since: input.since ?? defaultSince(),
      limit: input.limit,
    });
    const records = await loadRecords(db, definition, context.companyId, ids);
    const rows = ids.flatMap((id) => records.get(id) ?? []);
    const done = ids.length < input.limit;
    return {
      entity,
      rows,
      nextAfter: done ? null : ids[ids.length - 1],
      done,
    };
  }

  async pull(
    context: ReplicationContext,
    input: { cursor: number; limit: number }
  ): Promise<PullResponse> {
    void this.purgeIfDue();
    const readable = await scope(context);
    const scopeNames = readable.map((definition) => definition.name);
    const page = await syncChangesRepository.read(context.companyId, input.cursor, input.limit);
    if (page.resync) {
      return { cursor: input.cursor, hasMore: false, resync: true, scope: scopeNames, changes: [] };
    }

    // Several changes of one row in the page: its current state is sent once.
    const idsByEntity = new Map<SyncTable, Set<string>>();
    const order: { entity: SyncTable; id: string }[] = [];
    for (const change of page.changes) {
      const entity = change.entity as SyncTable;
      if (!scopeNames.includes(entity)) continue;
      const ids = idsByEntity.get(entity) ?? new Set<string>();
      if (!ids.has(change.entityId)) order.push({ entity, id: change.entityId });
      ids.add(change.entityId);
      idsByEntity.set(entity, ids);
    }

    const loaded = new Map<SyncTable, Awaited<ReturnType<typeof loadRecords>>>();
    for (const [entity, ids] of idsByEntity) {
      loaded.set(entity, await loadRecords(db, syncEntity(entity), context.companyId, [...ids]));
    }

    const changes: PullChange[] = order.map(({ entity, id }) => {
      const record = loaded.get(entity)?.get(id);
      return record
        ? { entity, entityId: id, operation: "UPSERT", version: record.version, data: record.data }
        : { entity, entityId: id, operation: "DELETE" };
    });

    return {
      cursor: page.cursor,
      hasMore: page.hasMore,
      resync: false,
      scope: scopeNames,
      changes,
    };
  }

  private async purgeIfDue(): Promise<void> {
    if (Date.now() - lastPurgeAt < PURGE_INTERVAL_MS) return;
    lastPurgeAt = Date.now();
    try {
      const removed = await syncChangesRepository.purge(CHANGE_LOG_RETENTION_DAYS);
      if (removed > 0) logger.info("Sync change log purged", { removed });
    } catch (error) {
      logger.warn("Sync change log purge failed", {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const replicationApplication = new ReplicationApplication();
