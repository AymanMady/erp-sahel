/** Persistance du journal de synchronisation et du registre des postes. */

import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";

import { syncDevices, syncOperations, type SyncOperation } from "@shared/schema";
import { db, type Database } from "../../db";

export class SyncRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): SyncRepository {
    return new SyncRepository(tx);
  }

  /** Opération déjà ingérée, quel que soit son statut. */
  async findByClientUuid(clientUuid: string): Promise<SyncOperation | null> {
    const [row] = await this.database
      .select()
      .from(syncOperations)
      .where(eq(syncOperations.clientUuid, clientUuid))
      .limit(1);
    return row ?? null;
  }

  /** Identifiants serveur des opérations réussies — résolution des références croisées. */
  async resolveServerIds(clientUuids: string[]): Promise<Map<string, string>> {
    if (clientUuids.length === 0) return new Map();
    const rows = await this.database
      .select({ clientUuid: syncOperations.clientUuid, serverId: syncOperations.serverId })
      .from(syncOperations)
      .where(
        and(
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
      // Deux envois simultanés du même lot : le second ne crée pas de doublon et
      // n'écrase pas le résultat du premier.
      .onConflictDoUpdate({
        target: syncOperations.clientUuid,
        set: { updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async listSince(companyId: string, since: Date, limit = 500): Promise<SyncOperation[]> {
    return this.database
      .select()
      .from(syncOperations)
      .where(
        and(
          eq(syncOperations.companyId, companyId),
          eq(syncOperations.status, "created"),
          gt(syncOperations.createdAt, since)
        )
      )
      .orderBy(desc(syncOperations.createdAt))
      .limit(limit);
  }

  /** Journal des dernières remontées, pour l'écran de supervision de la synchronisation. */
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

  async listDevices(companyId: string) {
    return this.database
      .select()
      .from(syncDevices)
      .where(eq(syncDevices.companyId, companyId))
      .orderBy(desc(syncDevices.updatedAt));
  }

  /** Compteurs pour l'indicateur d'état de synchronisation ([FR-SYNC-6]). */
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
