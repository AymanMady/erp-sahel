/**
 * Local database of the desktop workstation (`src-tauri/src/local_db`): one SQLite
 * file per company, the working copy the screens read and write offline-first
 * (`docs/OFFLINE_SYNC.md`).
 *
 * Only one company is open at a time. Every command carries its id, and the shell
 * refuses a command for a company that is not the open one: a screen can never read
 * another company's data, even after a company switch in the middle of a request.
 *
 * Unlike `tauriInvoke`, failures are thrown: a local write that did not happen must
 * never look as if it had.
 */

import type { SyncTable } from "@shared/sync-protocol";
import { isTauriDesktop, tauriCommand } from "@/shared/desktop/desktop";

export interface LocalRow<T = Record<string, unknown>> {
  id: string;
  version: number;
  /** Changed here, not yet accepted by the server. */
  pending: boolean;
  /** Deleted here, not yet confirmed by the server. */
  deletedAt: string | null;
  data: T;
}

export type QueueOperation = "CREATE" | "UPDATE" | "DELETE";
export type QueueStatus = "pending" | "sending" | "synced" | "failed" | "conflict" | "deferred";

export interface QueueEntryInput {
  /** Idempotency key sent to the server (`clientUuid`). */
  id: string;
  /** Entity of the synchronization protocol (`catalog.product`, `http.request`…). */
  entity: string;
  localTable?: SyncTable | null;
  entityId?: string | null;
  operation: QueueOperation;
  payload: unknown;
  dependsOn?: string[];
  baseVersion?: number | null;
  userId?: string | null;
  label?: string;
  /** Only when importing the former outbox. */
  seq?: number;
  status?: QueueStatus;
  createdAt?: string;
}

export interface QueueRow extends Required<Omit<QueueEntryInput, "seq" | "status" | "createdAt">> {
  seq: number;
  status: QueueStatus;
  retryCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  serverId: string | null;
  assignedNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RowWrite {
  entity: SyncTable;
  id: string;
  /** Server version the local data is based on; kept as is when absent. */
  version?: number | null;
  data?: Record<string, unknown>;
  /** Deleted here: kept, marked, until the server confirms. */
  deleted?: boolean;
  /**
   * Reflection of what the server will compute (stock after a sale, session totals):
   * not pending, version kept — the server's figure replaces it at the next pull.
   */
  derived?: boolean;
}

export interface ServerRow {
  entity: SyncTable;
  id: string;
  version: number;
  /** Absent: deleted on the server. */
  data?: Record<string, unknown> | null;
}

export interface ApplyBatch {
  rows?: ServerRow[];
  cursor?: number | null;
  progress?: {
    entity: SyncTable;
    afterId: string | null;
    rows: number;
    total?: number | null;
    done: boolean;
  } | null;
  meta?: [string, string][];
  /** First page of a new download of this entity: its unchanged rows are dropped first. */
  replaceEntity?: SyncTable | null;
}

export interface Ack {
  id: string;
  status: Exclude<QueueStatus, "sending">;
  serverId?: string | null;
  assignedNumber?: string | null;
  error?: string | null;
  nextAttemptAt?: string | null;
  serverRow?: ServerRow | null;
  conflict?: { fields: string[] } | null;
}

export interface QuerySpec {
  entity: SyncTable;
  /**
   * `column`: a column of the local table or `json:<key>` of the server row.
   * `arrayHas`: `column` is `json:<list>`, `value` is `{ key, equals }`.
   */
  filters?: {
    column: string;
    op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "isNull" | "notNull" | "arrayHas";
    value?: unknown;
  }[];
  /** `columns` contain the term; `exactColumns` equal it. */
  search?: { term: string; columns: string[]; exactColumns?: string[] } | null;
  orderBy?: { column: string; desc?: boolean }[];
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export interface ConflictRow {
  id: string;
  queueId: string;
  entity: SyncTable;
  entityId: string | null;
  fields: string[];
  localPayload: unknown;
  serverData: Record<string, unknown> | null;
  serverVersion: number | null;
  createdAt: string;
}

export interface BootstrapProgress {
  entity: SyncTable;
  afterId: string | null;
  rows: number;
  total: number | null;
  done: boolean;
}

export interface LogRow {
  id: number;
  at: string;
  level: "info" | "warn" | "error";
  event: string;
  detail: string;
}

export interface OpenInfo {
  companyId: string;
  schemaVersion: number;
  cursor: number | null;
  bootstrapCompletedAt: string | null;
  recovered: number;
}

let openCompanyId: string | null = null;
const openListeners = new Set<(companyId: string | null) => void>();

/** True in the desktop shell: the local database exists there only. */
export function hasLocalDatabase(): boolean {
  return isTauriDesktop();
}

/** Company whose database is open, if any. */
export function localCompanyId(): string | null {
  return openCompanyId;
}

export function onLocalDatabaseChange(listener: (companyId: string | null) => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

function announce(companyId: string | null) {
  openCompanyId = companyId;
  for (const listener of openListeners) listener(companyId);
}

/**
 * Opens the database of a company, closing any other. Called when a session starts
 * and when the person switches company.
 */
export async function openLocalDatabase(companyId: string): Promise<OpenInfo | null> {
  if (!hasLocalDatabase()) return null;
  const wanted = companyId.toLowerCase();
  if (openCompanyId === wanted) return null;
  // Nothing may read the previous company while the switch happens.
  announce(null);
  const info = await tauriCommand<OpenInfo>("local_open", { companyId: wanted });
  announce(wanted);
  return info;
}

/** Closes the open database (sign-out). Its content stays on disk. */
export async function closeLocalDatabase(): Promise<void> {
  if (!hasLocalDatabase() || !openCompanyId) return;
  announce(null);
  await tauriCommand<void>("local_close");
}

function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const companyId = openCompanyId;
  if (!companyId) return Promise.reject(new Error("The local database is not open."));
  return tauriCommand<T>(command, { companyId, ...args });
}

export const localDb = {
  metaGet: (key: string) => call<string | null>("local_meta_get", { key }),
  metaSet: (key: string, value: string) => call<void>("local_meta_set", { key, value }),

  /** Local rows and their queue entries, in one transaction. */
  write: (input: { rows?: RowWrite[]; queue?: QueueEntryInput[] }) =>
    call<{ seqs: number[] }>("local_write", {
      input: { rows: input.rows ?? [], queue: input.queue ?? [] },
    }),
  /** Server rows with their cursor or bootstrap progress, in one transaction. */
  apply: (batch: ApplyBatch) =>
    call<{ applied: number; skipped: number }>("local_apply", { batch }),
  get: <T = Record<string, unknown>>(entity: SyncTable, ids: string[]) =>
    call<LocalRow<T>[]>("local_get", { entity, ids }),
  query: <T = Record<string, unknown>>(spec: QuerySpec) =>
    call<{ rows: LocalRow<T>[]; total: number }>("local_query", { spec }),

  queueReady: (limit: number) => call<QueueRow[]>("local_queue_ready", { limit }),
  queueList: (statuses: QueueStatus[] = [], limit = 200) =>
    call<QueueRow[]>("local_queue_list", { statuses, limit }),
  queueMarkSending: (ids: string[]) => call<void>("local_queue_mark_sending", { ids }),
  queueRecover: () => call<number>("local_queue_recover"),
  queueAck: (ack: Ack) => call<void>("local_queue_ack", { ack }),
  queueCounts: () =>
    call<{ pending: number; failed: number; conflicts: number }>("local_queue_counts"),
  queueRetry: (id: string) => call<boolean>("local_queue_retry", { id }),
  queuePurge: (olderThanDays: number) => call<number>("local_queue_purge", { olderThanDays }),

  conflictsOpen: () => call<ConflictRow[]>("local_conflicts_open"),
  conflictResolve: (
    id: string,
    resolution: "keep_local" | "keep_server",
    requeue?: QueueEntryInput | null
  ) => call<void>("local_conflict_resolve", { id, resolution, requeue: requeue ?? null }),

  bootstrapProgress: () => call<BootstrapProgress[]>("local_bootstrap_progress"),
  bootstrapReset: () => call<void>("local_bootstrap_reset"),

  log: (level: LogRow["level"], event: string, detail = "") =>
    call<void>("local_log_append", { level, event, detail }),
  logList: (limit = 200) => call<LogRow[]>("local_log_list", { limit }),
};

export type LocalDb = typeof localDb;
