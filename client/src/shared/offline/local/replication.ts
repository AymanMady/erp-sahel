/**
 * Server → workstation: first synchronization (bootstrap) and incremental pull into the
 * local database (`docs/OFFLINE_SYNC.md` §Bootstrap, §Pull).
 *
 * Resumable by construction: every page is stored in one transaction with the progress
 * that covers it (`bootstrap_progress`), and the cursor only moves with the changes it
 * covers. A cut, a crash or a closed window at any point resumes after the last page
 * stored — never with a half-written page, never skipping one.
 *
 * An entity is **ready** — its screens read the local database — once downloaded
 * whole. Until then, and whenever it goes stale, the screens keep their former path.
 */

import {
  BOOTSTRAP_PAGE_SIZE,
  PULL_PAGE_SIZE,
  SYNC_TABLES,
  type BootstrapPageResponse,
  type BootstrapStartResponse,
  type PullResponse,
  type SyncTable,
} from "@shared/sync-protocol";
import { api } from "@/shared/api/http";
import { queryClient } from "@/shared/api/query-client";
import { devicePlatform } from "@/shared/desktop/desktop";
import { localCompanyId, localDb, type BootstrapProgress } from "./local-db";

const META = {
  cursor: "last_sync_cursor",
  completedAt: "bootstrap_completed_at",
  /** Cursor and history window of the bootstrap in progress (kept to resume it). */
  bootstrapCursor: "bootstrap_cursor",
  bootstrapSince: "bootstrap_since",
  bootstrapEntities: "bootstrap_entities",
} as const;

export interface BootstrapState {
  running: boolean;
  /** Rows stored so far, all entities together. */
  rows: number;
  /** Rows announced by the server, when known. */
  total: number;
  entity: SyncTable | null;
}

let state: BootstrapState = { running: false, rows: 0, total: 0, entity: null };
const progressListeners = new Set<(state: BootstrapState) => void>();

function publish(patch: Partial<BootstrapState>) {
  state = { ...state, ...patch };
  for (const listener of progressListeners) listener(state);
}

export function getBootstrapState(): BootstrapState {
  return state;
}

export function onBootstrapProgress(listener: (state: BootstrapState) => void): () => void {
  progressListeners.add(listener);
  listener(state);
  return () => progressListeners.delete(listener);
}

// ─── Readiness ────────────────────────────────────────────────────────────────

let ready = new Set<SyncTable>();
let readyCompany: string | null = null;
/** The first synchronization of `readyCompany` is complete. */
let complete = false;
const readyListeners = new Set<() => void>();

/**
 * True when the screens of this entity read the local database: the database of the
 * session's company is open, and the entity has been downloaded whole and is not stale.
 */
export function isLocalReady(entity: SyncTable): boolean {
  const companyId = localCompanyId();
  return !!companyId && readyCompany === companyId && ready.has(entity);
}

/** True once the first synchronization of the open company database is complete. */
export function isLocalComplete(): boolean {
  const companyId = localCompanyId();
  return !!companyId && readyCompany === companyId && complete;
}

export function onLocalReadinessChange(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

/** Reads which entities are ready from the local database. */
export async function refreshReadiness(): Promise<Set<SyncTable>> {
  const companyId = localCompanyId();
  const next = new Set<SyncTable>();
  const completed = !!companyId && !!(await localDb.metaGet(META.completedAt));
  if (completed) {
    for (const progress of await localDb.bootstrapProgress()) {
      if (progress.done) next.add(progress.entity);
    }
  }
  const changed =
    readyCompany !== companyId ||
    complete !== completed ||
    next.size !== ready.size ||
    [...next].some((entity) => !ready.has(entity));
  ready = next;
  readyCompany = companyId;
  complete = completed;
  if (changed) {
    for (const listener of readyListeners) listener();
    // Screens switch source (local database or server): read them again.
    void queryClient.invalidateQueries();
  }
  return next;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function inOrder(entities: Iterable<SyncTable>): SyncTable[] {
  const wanted = new Set(entities);
  return SYNC_TABLES.filter((entity) => wanted.has(entity));
}

/**
 * Downloads one entity page after page, resuming after the last page stored. `replace`:
 * a new download of an entity already held — its old rows go with the first page.
 */
async function downloadEntity(
  entity: SyncTable,
  since: string,
  progress: BootstrapProgress | undefined,
  total: number | null,
  replace: boolean
): Promise<void> {
  let after = progress && !progress.done ? progress.afterId : null;
  let first = !after;
  publish({ entity });
  for (;;) {
    const page = await api.get<BootstrapPageResponse>(`/api/sync/bootstrap/${entity}`, {
      after: after ?? undefined,
      limit: BOOTSTRAP_PAGE_SIZE,
      since,
    });
    const lastId = page.rows.length > 0 ? page.rows[page.rows.length - 1].id : after;
    await localDb.apply({
      rows: page.rows.map((row) => ({ entity, id: row.id, version: row.version, data: row.data })),
      progress: { entity, afterId: lastId ?? null, rows: page.rows.length, total, done: page.done },
      replaceEntity: replace && first ? entity : null,
    });
    publish({ rows: state.rows + page.rows.length });
    first = false;
    if (page.done) return;
    after = page.nextAfter ?? lastId ?? null;
  }
}

/**
 * First synchronization, resumed if it was interrupted. The cursor was taken by the
 * server **before** the first page: it only becomes the pull cursor once every page is
 * stored, in the same transaction that marks the bootstrap complete.
 */
async function bootstrap(): Promise<void> {
  let cursor = Number((await localDb.metaGet(META.bootstrapCursor)) ?? Number.NaN);
  let since = await localDb.metaGet(META.bootstrapSince);
  let announced: BootstrapStartResponse["entities"] =
    JSON.parse((await localDb.metaGet(META.bootstrapEntities)) ?? "null") ?? [];

  if (!Number.isFinite(cursor) || !since || announced.length === 0) {
    const start = await api.post<BootstrapStartResponse>("/api/sync/bootstrap", {
      platform: devicePlatform(),
    });
    cursor = start.cursor;
    since = start.since;
    announced = start.entities;
    await localDb.apply({
      meta: [
        [META.bootstrapCursor, String(cursor)],
        [META.bootstrapSince, since],
        [META.bootstrapEntities, JSON.stringify(announced)],
      ],
    });
    await localDb.log("info", "bootstrap.started", `${announced.length} entities`);
  } else {
    await localDb.log("info", "bootstrap.resumed");
  }

  const progress = new Map((await localDb.bootstrapProgress()).map((row) => [row.entity, row]));
  const total = announced.reduce((sum, entry) => sum + entry.total, 0);
  const already = [...progress.values()].reduce((sum, row) => sum + row.rows, 0);
  publish({ running: true, rows: already, total, entity: null });
  try {
    for (const { entity, total: entityTotal } of announced) {
      if (progress.get(entity)?.done) continue;
      await downloadEntity(entity, since, progress.get(entity), entityTotal, false);
    }
    await localDb.apply({
      cursor,
      meta: [[META.completedAt, new Date().toISOString()]],
    });
    await localDb.log("info", "bootstrap.completed", `${state.rows} rows`);
  } finally {
    publish({ running: false, entity: null });
  }
}

/**
 * Brings the held entities in line with what this person may receive (`scope` of the
 * pull): entities left out go **stale** — their local copy no longer follows the
 * server, so their screens stop reading it — and entities newly in scope, or stale
 * ones back in scope, are downloaded whole.
 */
async function reconcileScope(scope: SyncTable[]): Promise<void> {
  const progress = new Map((await localDb.bootstrapProgress()).map((row) => [row.entity, row]));
  const allowed = new Set(scope);

  for (const [entity, row] of progress) {
    if (!allowed.has(entity) && row.done) {
      await localDb.apply({ progress: { entity, afterId: null, rows: 0, done: false } });
      await localDb.log("warn", "entity.stale", entity);
    }
  }

  const missing = inOrder(scope).filter((entity) => !progress.get(entity)?.done);
  if (missing.length === 0) return;
  // A fresh history window; the pull cursor stays: rows downloaded now are newer than
  // it, and the next pulls replay anything later with the version guard.
  const start = await api.post<BootstrapStartResponse>("/api/sync/bootstrap", {
    platform: devicePlatform(),
  });
  const totals = new Map(start.entities.map((entry) => [entry.entity, entry.total]));
  publish({
    running: true,
    rows: 0,
    total: missing.reduce((sum, e) => sum + (totals.get(e) ?? 0), 0),
  });
  try {
    for (const entity of missing) {
      if (!totals.has(entity)) continue;
      await downloadEntity(entity, start.since, undefined, totals.get(entity) ?? null, true);
      await localDb.log("info", "entity.downloaded", entity);
    }
  } finally {
    publish({ running: false, entity: null });
  }
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

/** Downloads everything if needed, then every change since the cursor. */
export async function pullIntoLocal(): Promise<{ changes: number }> {
  if (!(await localDb.metaGet(META.completedAt))) await bootstrap();

  let changes = 0;
  let reconciled = false;
  for (;;) {
    const cursor = Number((await localDb.metaGet(META.cursor)) ?? "0");
    const page = await api.get<PullResponse>("/api/sync/pull", {
      cursor,
      limit: PULL_PAGE_SIZE,
    });
    if (page.resync) {
      // The server log no longer covers this workstation: download everything again.
      // Local changes and the queue are kept (`bootstrap_reset`).
      await localDb.log("warn", "pull.resync", String(cursor));
      await localDb.bootstrapReset();
      await refreshReadiness();
      await bootstrap();
      continue;
    }
    await localDb.apply({
      rows: page.changes.map((change) => ({
        entity: change.entity,
        id: change.entityId,
        version: change.version ?? 0,
        data: change.operation === "DELETE" ? null : change.data,
      })),
      cursor: page.cursor,
    });
    changes += page.changes.length;
    if (!reconciled) {
      reconciled = true;
      await reconcileScope(page.scope);
    }
    if (!page.hasMore) break;
  }
  if (changes > 0) await localDb.log("info", "pull.completed", `${changes} changes`);
  await refreshReadiness();
  return { changes };
}
