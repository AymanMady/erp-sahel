/** API du module Marché : lots datés et alertes de péremption. */

import type { Express } from "express";
import { asc } from "drizzle-orm";
import { z } from "zod";

import { productLots } from "@shared/schema";
import { db } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { asyncHandler } from "../../shared/http/handler";
import { TenantRepository } from "../../shared/db/tenant-repository";
import { authOf, authorize, requireAuth, requireModule } from "../../domains/auth/guards";
import { listExpiringLots } from "./plugin";

export const productLotsRepository = new TenantRepository(productLots, [
  productLots.lotNumber,
  productLots.supplierRef,
]);

const lotSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid().nullish(),
  lotNumber: z.string().min(1, "Le numéro de lot est obligatoire").max(64),
  expiryDate: z.string().date().nullish(),
  receivedQuantity: z.union([z.number().min(0), z.string()]).default("0"),
  supplierRef: z.string().max(64).default(""),
});

const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });

const guards = [requireAuth, requireModule("market")] as const;
const canRead = authorize({ anyPermission: ["market.read", "inventory.read"] });
const canWrite = authorize({ anyPermission: ["market.write", "inventory.write"] });

export function registerMarketRoutes(app: Express): void {
  const base = "/api/modules/market";

  app.get(
    `${base}/lots`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(
        await productLotsRepository.list(authOf(req).companyId, {
          search: typeof req.query.search === "string" ? req.query.search : undefined,
          orderBy: [asc(productLots.expiryDate)],
          limit: Number(req.query.limit ?? 50),
          offset: Number(req.query.offset ?? 0),
        })
      );
    })
  );

  app.post(
    `${base}/lots`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const data = lotSchema.parse(req.body);
      res.status(201).json(
        await productLotsRepository.create(authOf(req).companyId, {
          ...data,
          receivedQuantity: String(data.receivedQuantity),
        })
      );
    })
  );

  app.patch(
    `${base}/lots/:id`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const data = lotSchema.partial().parse(req.body);
      const lot = await productLotsRepository.update(authOf(req).companyId, id, {
        ...data,
        ...(data.receivedQuantity != null
          ? { receivedQuantity: String(data.receivedQuantity) }
          : {}),
      });
      if (!lot) throw new NotFoundError("Lot introuvable.");
      res.json(lot);
    })
  );

  /** Lots arrivant à échéance — alimente l'écran d'alertes péremption. */
  app.get(
    `${base}/expiring`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      const withinDays = Math.min(365, Math.max(1, Number(req.query.withinDays ?? 30)));
      res.json(await listExpiringLots(db, authOf(req).companyId, withinDays));
    })
  );
}
