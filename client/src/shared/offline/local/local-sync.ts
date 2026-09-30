/**
 * Offline-first mode of the desktop workstation: opening the company database, moving
 * the former outbox into it, and one synchronization cycle (`docs/OFFLINE_SYNC.md`).
 */

import { getCachedSession } from "@/shared/auth/token-store";
import { tauriInvoke } from "@/shared/desktop/desktop";
import { offlineDb, type OutboxRecord } from "../db";
import { readSnapshot } from "../snapshot";
import {
  closeLocalDatabase,
  hasLocalDatabase,
  localCompanyId,
  localDb,
  openLocalDatabase,
} from "./local-db";
import { queueEntryOf } from "./queue-entry";
import { pushLocalQueue, type PushSummary } from "./local-push";
import { pullIntoLocal, refreshReadiness } from "./replication";

const LEGACY_IMPORTED_KEY = "legacy_outbox_imported_at";
/** Accepted operations are kept a week: provisional → final number, for field checks. */
const KEEP_SYNCED_DAYS = 7;

/** Former SQLite outbox row (`offline_outbox_pending`). */
interface LegacySqliteRow {
  clientUuid: string;
  localSeq: number;
  entity: string;
  payload: string;
  dependsOn: string;
  status: string;
  attempts: number;
  lastError: string | null;
  label: string;
}

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Moves the operations of the former outbox (IndexedDB, and its SQLite copy) that the
 * server has not accepted yet into `sync_queue` — once, in one transaction, with their
 * id, order and state. The former copies are **left in place**: they are the backup
 * until the new queue has sent everything.
 *
 * Only for the company they were entered in: sent under another company, they would
 * write into the wrong accounts.
 */
async function importLegacyOutbox(companyId: string): Promise<number> {
  if (await localDb.metaGet(LEGACY_IMPORTED_KEY)) return 0;

  const owner = (await readSnapshot())?.company?.id ?? getCachedSession()?.company?.id ?? null;
  const byId = new Map<string, OutboxRecord>();
  try {
    for (const record of await offlineDb.outbox.toArray()) {
      if (record.status !== "synced") byId.set(record.clientUuid, record);
    }
  } catch {
    // IndexedDB unavailable: the SQLite copy below is enough.
  }
  const sqliteRows =
    (await tauriInvoke<LegacySqliteRow[]>("offline_outbox_pending", { limit: 100_000 })) ?? [];
  for (const row of sqliteRows) {
    if (byId.has(row.clientUuid)) continue;
    const now = new Date().toISOString();
    byId.set(row.clientUuid, {
      clientUuid: row.clientUuid,
      localSeq: row.localSeq,
      entity: row.entity as OutboxRecord["entity"],
      action: "create",
      payload: parse(row.payload, {}),
      dependsOn: parse(row.dependsOn, []),
      status: row.status === "error" ? "error" : row.status === "deferred" ? "deferred" : "pending",
      attempts: row.attempts,
      lastError: row.lastError,
      provisionalNumber: null,
      assignedNumber: null,
      serverId: null,
      createdAt: now,
      updatedAt: now,
      label: row.label,
      amountCents: null,
    });
  }

  if (byId.size > 0 && owner && owner.toLowerCase() !== companyId) {
    await localDb.log(
      "warn",
      "legacy.other_company",
      `${byId.size} operations wait for company ${owner}`
    );
    return 0;
  }
  const entries = [...byId.values()].sort((a, b) => a.localSeq - b.localSeq).map(queueEntryOf);
  if (entries.length > 0) await localDb.write({ queue: entries });
  await localDb.metaSet(LEGACY_IMPORTED_KEY, new Date().toISOString());
  if (entries.length > 0)
    await localDb.log("info", "legacy.imported", `${entries.length} operations`);
  return entries.length;
}

/**
 * Opens the local database of the session's company (desktop only). Returns false when
 * the offline-first mode is not available, the former path then stays in use.
 */
export async function startLocalSession(companyId: string): Promise<boolean> {
  if (!hasLocalDatabase()) return false;
  try {
    const info = await openLocalDatabase(companyId);
    if (info?.recovered)
      await localDb.log("warn", "queue.recovered", `${info.recovered} operations`);
    await importLegacyOutbox(companyId.toLowerCase());
    await refreshReadiness();
    return true;
  } catch (error) {
    console.error("[local-db] could not open the local database", error);
    await closeLocalDatabase().catch(() => undefined);
    await refreshReadiness().catch(() => undefined);
    return false;
  }
}

export async function stopLocalSession(): Promise<void> {
  await closeLocalDatabase();
  await refreshReadiness();
}

/** True when the offline-first mode is on for the current session. */
export function isLocalMode(): boolean {
  return localCompanyId() !== null;
}

/** One cycle: send the queue, then receive the changes. Throws on a network failure. */
export async function runLocalCycle(): Promise<PushSummary> {
  const pushed = await pushLocalQueue();
  await pullIntoLocal();
  await localDb.queuePurge(KEEP_SYNCED_DAYS);
  return pushed;
}
