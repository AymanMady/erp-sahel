/**
 * Prestations facturables — domaine volontairement mince.
 *
 * Aucune orchestration inter-domaines : une prestation n'a ni stock ni écriture
 * propre, elle n'existe qu'en tant que ligne de document. Le service parle donc
 * directement au repository générique, sans couche `application` artificielle.
 */

import type { Express } from "express";
import { asc } from "drizzle-orm";
import { z } from "zod";

import { BILLING_TYPES, services } from "@shared/schema";
import { asyncHandler } from "../../shared/http/handler";
import { TenantRepository } from "../../shared/db/tenant-repository";
import { NotFoundError } from "../../shared/errors/app-error";
import { authOf, authorize, requireAuth } from "../auth/guards";

export const servicesRepository = new TenantRepository(services, [
  services.code,
  services.name,
  services.description,
]);

const createServiceSchema = z.object({
  code: z.string().min(1, "Le code est obligatoire").max(64),
  name: z.string().min(1, "Le libellé est obligatoire").max(255),
  description: z.string().max(4000).default(""),
  billingType: z.enum(BILLING_TYPES).default("HOURLY"),
  priceCents: z.number().int().min(0).default(0),
  vatRateBp: z.number().int().min(0).max(10_000).default(0),
});

const updateServiceSchema = createServiceSchema.partial();

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });

const canRead = authorize({ anyPermission: ["services.read", "catalog.read"] });
const canWrite = authorize({ anyPermission: ["services.write", "catalog.write"] });

export function registerServicesRoutes(app: Express): void {
  app.get(
    "/api/services",
    requireAuth,
    canRead,
    asyncHandler(async (req, res) => {
      const query = listQuerySchema.parse(req.query ?? {});
      res.json(
        await servicesRepository.list(authOf(req).companyId, {
          ...query,
          orderBy: [asc(services.name)],
        })
      );
    })
  );

  app.get(
    "/api/services/:id",
    requireAuth,
    canRead,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      res.json(await servicesRepository.requireById(authOf(req).companyId, id));
    })
  );

  app.post(
    "/api/services",
    requireAuth,
    canWrite,
    asyncHandler(async (req, res) => {
      const data = createServiceSchema.parse(req.body);
      res.status(201).json(await servicesRepository.create(authOf(req).companyId, data));
    })
  );

  app.patch(
    "/api/services/:id",
    requireAuth,
    canWrite,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const data = updateServiceSchema.parse(req.body);
      const service = await servicesRepository.update(authOf(req).companyId, id, data);
      if (!service) throw new NotFoundError("Prestation introuvable.");
      res.json(service);
    })
  );

  app.delete(
    "/api/services/:id",
    requireAuth,
    canWrite,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const archived = await servicesRepository.archive(authOf(req).companyId, id);
      if (!archived) throw new NotFoundError("Prestation introuvable.");
      res.json({ success: true });
    })
  );
}
