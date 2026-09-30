/** Application boundary of synchronization. */

import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import {
  bootstrapPageQuerySchema,
  isSyncTable,
  pullQuerySchema as cursorPullQuerySchema,
  syncPushRequestSchema,
} from "@shared/sync-protocol";
import { parties, products, services, stockItems } from "@shared/schema";
import { db } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { tenancyApplication } from "../tenancy/application";
import { syncApplication } from "./application";
import { replicationApplication, type ReplicationContext } from "./replication";
import { syncRepository } from "./repository";
import { buildSyncSnapshot, syncCursor } from "./snapshot";

const pullQuerySchema = z.object({
  since: z.string().datetime().optional(),
  deviceId: z.string().max(128).optional(),
});

/** Largest delta served; beyond, the device takes a full snapshot (`resync`). */
const PULL_LIMITS = {
  products: 2000,
  parties: 2000,
  services: 500,
  stock: 5000,
  operations: 500,
} as const;

/** Platform declared by the device; `web` by default (the most restrictive). */
function normalizePlatform(value: unknown): string {
  const platform = String(value ?? "web").toLowerCase();
  return platform === "desktop" || platform === "android" ? platform : "web";
}

export class SyncService {
  async snapshot(input: {
    companyId: string;
    userId: string;
    deviceId: string;
    platform: unknown;
    isSuperuser: boolean;
    permissions: readonly string[];
  }) {
    const platform = normalizePlatform(input.platform);
    // Password hashes only go to a desktop an administrator approved, for someone who
    // works at the register.
    const includeOfflineLogins =
      platform === "desktop" &&
      (input.isSuperuser || input.permissions.includes("pos.use")) &&
      (await syncRepository.isOfflineLoginAllowed(input.companyId, input.deviceId));
    const snapshot = await buildSyncSnapshot({
      companyId: input.companyId,
      userId: input.userId,
      platform,
      includeOfflineLogins,
    });
    await syncRepository.touchDevice({
      companyId: input.companyId,
      deviceId: input.deviceId,
      userId: input.userId,
      platform,
      snapshot: true,
    });
    return snapshot;
  }

  /** First synchronization of an offline-first workstation: cursor and what to download. */
  async bootstrapStart(context: ReplicationContext & { deviceId: string; platform: unknown }) {
    const result = await replicationApplication.bootstrapStart(context);
    await syncRepository.touchDevice({
      companyId: context.companyId,
      deviceId: context.deviceId,
      userId: context.userId,
      platform: normalizePlatform(context.platform),
      snapshot: true,
    });
    return result;
  }

  async bootstrapPage(context: ReplicationContext, entity: unknown, query: unknown) {
    const name = String(entity ?? "");
    if (!isSyncTable(name)) throw new NotFoundError("Resource not found");
    return replicationApplication.bootstrapPage(
      context,
      name,
      bootstrapPageQuerySchema.parse(query ?? {})
    );
  }

  /** Changes after an integer cursor, from the change log (offline-first workstations). */
  async pullChanges(context: ReplicationContext, query: unknown) {
    return replicationApplication.pull(context, cursorPullQuerySchema.parse(query ?? {}));
  }

  /**
   * Delta since a cursor: only the reference data the device displays.
   * Without `since`, an empty delta is returned rather than the whole catalog — the
   * device must then request a full snapshot, which is explicit and bounded.
   *
   * The cursor comes from the database clock, a little in the past (`syncCursor`), and
   * is read **before** the changes: nothing written meanwhile can fall between two
   * deltas. When a list would not fit in one answer, nothing is cut silently: the
   * answer says `resync`, and the device takes a full snapshot instead.
   */
  async pull(companyId: string, query: unknown) {
    const { since } = pullQuerySchema.parse(query ?? {});
    const cursor = await syncCursor();
    const empty = {
      cursor,
      since: since ?? null,
      resync: false,
      products: [],
      parties: [],
      services: [],
      stock: [],
      operations: [],
    };
    if (!since) return empty;
    const sinceDate = new Date(since);

    const [changedProducts, changedParties, changedServices, changedStock, operations] =
      await Promise.all([
        db
          .select()
          .from(products)
          .where(and(eq(products.companyId, companyId), gt(products.updatedAt, sinceDate)))
          .limit(PULL_LIMITS.products + 1),
        db
          .select()
          .from(parties)
          .where(and(eq(parties.companyId, companyId), gt(parties.updatedAt, sinceDate)))
          .limit(PULL_LIMITS.parties + 1),
        db
          .select()
          .from(services)
          .where(and(eq(services.companyId, companyId), gt(services.updatedAt, sinceDate)))
          .limit(PULL_LIMITS.services + 1),
        // Whole balance of every product/store touched since the cursor, not only the
        // lines that changed: the device replaces its total.
        db
          .select({
            productId: stockItems.productId,
            warehouseId: stockItems.warehouseId,
            quantity: sql<string>`coalesce(sum(${stockItems.quantity}), 0)`,
          })
          .from(stockItems)
          .where(
            and(
              eq(stockItems.companyId, companyId),
              sql`(${stockItems.productId}, ${stockItems.warehouseId}) in (
                select changed.product_id, changed.warehouse_id from ${stockItems} changed
                where changed.company_id = ${companyId} and changed.updated_at > ${sinceDate}
              )`
            )
          )
          .groupBy(stockItems.productId, stockItems.warehouseId)
          .limit(PULL_LIMITS.stock + 1),
        syncRepository.listSince(companyId, sinceDate, PULL_LIMITS.operations),
      ]);

    if (
      changedProducts.length > PULL_LIMITS.products ||
      changedParties.length > PULL_LIMITS.parties ||
      changedServices.length > PULL_LIMITS.services ||
      changedStock.length > PULL_LIMITS.stock
    ) {
      return { ...empty, resync: true };
    }

    return {
      cursor,
      since,
      resync: false,
      products: changedProducts,
      parties: changedParties,
      services: changedServices,
      stock: changedStock,
      /** Operations ingested from other devices — useful for field monitoring. */
      operations: operations.map((operation) => ({
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        serverId: operation.serverId,
        assignedNumber: operation.assignedNumber,
        deviceId: operation.deviceId,
        createdAt: operation.createdAt,
      })),
    };
  }

  async push(input: {
    companyId: string;
    userId: string;
    isSuperuser: boolean;
    permissions: readonly string[];
    body: unknown;
  }) {
    const data = syncPushRequestSchema.parse(input.body);
    const company = await tenancyApplication.requireCompany(input.companyId);
    const results = await syncApplication.push(
      {
        company,
        userId: input.userId,
        deviceId: data.deviceId,
        isSuperuser: input.isSuperuser,
        permissions: input.permissions,
      },
      data.operations
    );
    return {
      results,
      cursor: new Date().toISOString(),
      serverTime: new Date().toISOString(),
    };
  }

  /** An administrator approves (or no longer approves) a desktop for signing in offline. */
  async setDeviceOfflineLogin(companyId: string, id: unknown, body: unknown) {
    const { id: deviceRowId } = z.object({ id: z.string().uuid() }).parse({ id });
    const { offlineLoginAllowed } = z.object({ offlineLoginAllowed: z.boolean() }).parse(body);
    const device = await syncRepository.setOfflineLoginAllowed(
      companyId,
      deviceRowId,
      offlineLoginAllowed
    );
    if (!device) throw new NotFoundError("Device not found.");
    return device;
  }

  async status(companyId: string) {
    const [stats, devices] = await Promise.all([
      syncApplication.stats(companyId),
      syncApplication.listDevices(companyId),
    ]);
    return { stats, devices };
  }

  async journal(companyId: string) {
    const rows = await syncApplication.listRecent(companyId, 200);
    // The journal row of a replayed HTTP write keeps the response served to replays:
    // it does not belong on the supervision screen.
    return rows.map((row) => (row.entity === "http.request" ? { ...row, payload: null } : row));
  }
}

export const syncService = new SyncService();
