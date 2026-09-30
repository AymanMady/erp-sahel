/** Persistence of the sync journal and the device registry. */

import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";

import { syncDevices, syncOperations, type SyncOperation } from "@shared/schema";
import { db, type Database } from "../../db";

export class SyncRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): SyncRepository {
    return new SyncRepository(tx);
  }

  /** Already-ingested operation of the company, whatever its status. */
  async findByClientUuid(companyId: string, clientUuid: string): Promise<SyncOperation | null> {
    const [row] = await this.database
      .select()
      .from(syncOperations)
      .where(
        and(eq(syncOperations.companyId, companyId), eq(syncOperations.clientUuid, clientUuid))
      )
      .limit(1);
    return row ?? null;
  }

  /** Serializes the ingestion of one operation until the end of the transaction. */
  async lockClientUuid(clientUuid: string): Promise<void> {
    await this.database.execute(sql`select pg_advisory_xact_lock(hashtext(${clientUuid}))`);
  }

  /**
   * Server ids of successful operations — resolution of cross references. Limited to
   * the company: a reference can never point to another company's data.
   */
  async resolveServerIds(companyId: string, clientUuids: string[]): Promise<Map<string, string>> {
    if (clientUuids.length === 0) return new Map();
    const rows = await this.database
      .select({ clientUuid: syncOperations.clientUuid, serverId: syncOperations.serverId })
      .from(syncOperations)
      .where(
        and(
          eq(syncOperations.companyId, companyId),
          inArray(syncOperations.clientUuid, clientUuids),
          inArray(syncOperations.status, ["created", "duplicate"]),
          sql`${syncOperations.serverId} <> ''`
        )
      );
    return new Map(rows.map((row) => [row.clientUuid, row.serverId]));
  }

  async record(values: typeof syncOperations.$inferInsert): Promise<SyncOperation> {
    const [row] = await this.database
      .insert(syncOperations)
      .values(values)
      // Two simultaneous submissions of the same batch: the second creates no duplicate
      // and does not overwrite the result of the first. A previous **failure**, on the
      // other hand, is replaced by the new outcome: an operation that succeeds on a
      // later attempt must no longer be reported (nor block what depends on it). Same
      // for a conflict: it is evaluated again on the next attempt.
      .onConflictDoUpdate({
        target: syncOperations.clientUuid,
        set: {
          status: sql`case when ${syncOperations.status} in ('error', 'conflict') then excluded.status else ${syncOperations.status} end`,
          serverId: sql`case when ${syncOperations.status} in ('error', 'conflict') then excluded.server_id else ${syncOperations.serverId} end`,
          assignedNumber: sql`case when ${syncOperations.status} in ('error', 'conflict') then excluded.assigned_number else ${syncOperations.assignedNumber} end`,
          detail: sql`case when ${syncOperations.status} in ('error', 'conflict') then excluded.detail else ${syncOperations.detail} end`,
          payload: sql`case when ${syncOperations.status} in ('error', 'conflict') then excluded.payload else ${syncOperations.payload} end`,
          updatedAt: new Date(),
        },
        // Never across companies.
        setWhere: sql`${syncOperations.companyId} = excluded.company_id`,
      })
      .returning();
    return row;
  }

  /**
   * Takes an idempotency key for an HTTP write, atomically. Returns `null` when the key
   * is now held by this request, otherwise the row that already holds it. A key left
   * `pending` for too long (server stopped mid-request) is taken over.
   */
  async claimHttpKey(values: typeof syncOperations.$inferInsert): Promise<SyncOperation | null> {
    const [claimed] = await this.database
      .insert(syncOperations)
      .values({ ...values, status: "pending" })
      .onConflictDoUpdate({
        target: syncOperations.clientUuid,
        set: { updatedAt: new Date(), userId: values.userId ?? null },
        setWhere: sql`${syncOperations.status} = 'pending'
          and ${syncOperations.companyId} = excluded.company_id
          and ${syncOperations.updatedAt} < now() - interval '2 minutes'`,
      })
      .returning();
    if (claimed) return null;
    const [holder] = await this.database
      .select()
      .from(syncOperations)
      .where(eq(syncOperations.clientUuid, String(values.clientUuid)))
      .limit(1);
    return holder ?? null;
  }

  /** Stores the response served for a held key: replays will receive it. */
  async completeHttpKey(
    clientUuid: string,
    values: Pick<typeof syncOperations.$inferInsert, "serverId" | "payload">
  ): Promise<void> {
    await this.database
      .update(syncOperations)
      .set({ ...values, status: "created", updatedAt: new Date() })
      .where(and(eq(syncOperations.clientUuid, clientUuid), eq(syncOperations.status, "pending")));
  }

  /** Frees a held key after a failure: the request may be sent again. */
  async releaseHttpKey(clientUuid: string): Promise<void> {
    await this.database
      .delete(syncOperations)
      .where(and(eq(syncOperations.clientUuid, clientUuid), eq(syncOperations.status, "pending")));
  }

  async listSince(companyId: string, since: Date, limit = 500): Promise<SyncOperation[]> {
    return this.database
      .select()
      .from(syncOperations)
      .where(
        and(
          eq(syncOperations.companyId, companyId),
          eq(syncOperations.status, "created"),
          // Replayed HTTP writes are not synchronizable entities.
          ne(syncOperations.entity, "http.request"),
          gt(syncOperations.createdAt, since)
        )
      )
      .orderBy(desc(syncOperations.createdAt))
      .limit(limit);
  }

  /** Journal of the latest uploads, for the sync supervision screen. */
  async listRecent(companyId: string, limit = 100): Promise<SyncOperation[]> {
    return this.database
      .select()
      .from(syncOperations)
      .where(eq(syncOperations.companyId, companyId))
      .orderBy(desc(syncOperations.createdAt))
      .limit(limit);
  }

  async touchDevice(input: {
    companyId: string;
    deviceId: string;
    userId?: string | null;
    platform?: string;
    label?: string;
    snapshot?: boolean;
    push?: boolean;
    pendingHint?: number;
  }): Promise<void> {
    const now = new Date();
    await this.database
      .insert(syncDevices)
      .values({
        companyId: input.companyId,
        deviceId: input.deviceId,
        label: input.label ?? "",
        platform: input.platform ?? "web",
        lastUserId: input.userId ?? null,
        lastSnapshotAt: input.snapshot ? now : null,
        lastPushAt: input.push ? now : null,
        pendingHint: input.pendingHint ?? 0,
      })
      .onConflictDoUpdate({
        target: [syncDevices.companyId, syncDevices.deviceId],
        set: {
          lastUserId: input.userId ?? null,
          ...(input.platform ? { platform: input.platform } : {}),
          ...(input.snapshot ? { lastSnapshotAt: now } : {}),
          ...(input.push ? { lastPushAt: now } : {}),
          ...(input.pendingHint != null ? { pendingHint: input.pendingHint } : {}),
          updatedAt: now,
        },
      });
  }

  async isOfflineLoginAllowed(companyId: string, deviceId: string): Promise<boolean> {
    const [row] = await this.database
      .select({ allowed: syncDevices.offlineLoginAllowed })
      .from(syncDevices)
      .where(and(eq(syncDevices.companyId, companyId), eq(syncDevices.deviceId, deviceId)))
      .limit(1);
    return row?.allowed ?? false;
  }

  async setOfflineLoginAllowed(companyId: string, id: string, allowed: boolean) {
    const [row] = await this.database
      .update(syncDevices)
      .set({ offlineLoginAllowed: allowed, updatedAt: new Date() })
      .where(and(eq(syncDevices.companyId, companyId), eq(syncDevices.id, id)))
      .returning();
    return row ?? null;
  }

  async listDevices(companyId: string) {
    return this.database
      .select()
      .from(syncDevices)
      .where(eq(syncDevices.companyId, companyId))
      .orderBy(desc(syncDevices.updatedAt));
  }

  /** Counters for the sync status indicator ([FR-SYNC-6]). */
  async stats(companyId: string) {
    const [row] = await this.database
      .select({
        created: sql<number>`count(*) filter (where ${syncOperations.status} = 'created')::int`,
        duplicates: sql<number>`count(*) filter (where ${syncOperations.status} = 'duplicate')::int`,
        errors: sql<number>`count(*) filter (where ${syncOperations.status} = 'error')::int`,
        deferred: sql<number>`count(*) filter (where ${syncOperations.status} = 'deferred')::int`,
      })
      .from(syncOperations)
      .where(eq(syncOperations.companyId, companyId));
    return {
      created: row?.created ?? 0,
      duplicates: row?.duplicates ?? 0,
      errors: row?.errors ?? 0,
      deferred: row?.deferred ?? 0,
    };
  }
}

export const syncRepository = new SyncRepository();
