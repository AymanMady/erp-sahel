/** Frontière applicative de la synchronisation. */

import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { syncPushRequestSchema } from "@shared/sync-protocol";
import { parties, products, services, stockItems } from "@shared/schema";
import { db } from "../../db";
import { tenancyApplication } from "../tenancy/application";
import { syncApplication } from "./application";
import { syncRepository } from "./repository";
import { buildSyncSnapshot } from "./snapshot";

const pullQuerySchema = z.object({
  since: z.string().datetime().optional(),
  deviceId: z.string().max(128).optional(),
});

/** Plateforme déclarée par le poste ; `web` par défaut (le plus restrictif). */
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
  }) {
    const platform = normalizePlatform(input.platform);
    const snapshot = await buildSyncSnapshot({
      companyId: input.companyId,
      userId: input.userId,
      platform,
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

  /**
   * Delta depuis un curseur : uniquement les référentiels que le poste affiche.
   * Sans `since`, on renvoie un delta vide plutôt que tout le catalogue — le poste
   * doit alors demander un instantané complet, ce qui est explicite et borné.
   */
  async pull(companyId: string, query: unknown) {
    const { since } = pullQuerySchema.parse(query ?? {});
    const cursor = new Date().toISOString();
    if (!since) {
      return {
        cursor,
        since: null,
        products: [],
        parties: [],
        services: [],
        stock: [],
        operations: [],
      };
    }
    const sinceDate = new Date(since);

    const [changedProducts, changedParties, changedServices, changedStock, operations] =
      await Promise.all([
        db
          .select()
          .from(products)
          .where(and(eq(products.companyId, companyId), gt(products.updatedAt, sinceDate)))
          .limit(2000),
        db
          .select()
          .from(parties)
          .where(and(eq(parties.companyId, companyId), gt(parties.updatedAt, sinceDate)))
          .limit(2000),
        db
          .select()
          .from(services)
          .where(and(eq(services.companyId, companyId), gt(services.updatedAt, sinceDate)))
          .limit(500),
        db
          .select({
            productId: stockItems.productId,
            warehouseId: stockItems.warehouseId,
            quantity: sql<string>`coalesce(sum(${stockItems.quantity}), 0)`,
          })
          .from(stockItems)
          .where(and(eq(stockItems.companyId, companyId), gt(stockItems.updatedAt, sinceDate)))
          .groupBy(stockItems.productId, stockItems.warehouseId)
          .limit(5000),
        syncRepository.listSince(companyId, sinceDate),
      ]);

    return {
      cursor,
      since,
      products: changedProducts,
      parties: changedParties,
      services: changedServices,
      stock: changedStock,
      /** Opérations ingérées depuis d'autres postes — utile au suivi terrain. */
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

  async push(input: { companyId: string; userId: string; body: unknown }) {
    const data = syncPushRequestSchema.parse(input.body);
    const company = await tenancyApplication.requireCompany(input.companyId);
    const results = await syncApplication.push(
      { company, userId: input.userId, deviceId: data.deviceId },
      data.operations
    );
    return {
      results,
      cursor: new Date().toISOString(),
      serverTime: new Date().toISOString(),
    };
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
    // Le journal d'une écriture HTTP rejouée conserve la réponse servie aux rejeux :
    // elle n'a rien à faire à l'écran de supervision.
    return rows.map((row) => (row.entity === "http.request" ? { ...row, payload: null } : row));
  }
}

export const syncService = new SyncService();
