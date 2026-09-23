/**
 * API du module Auto Parts.
 *
 * Toutes les routes sont derrière `requireModule("auto_parts")` : si la société n'a pas
 * activé le module, elles répondent 403 — la garde d'activation est serveur, pas
 * seulement décorative côté client ([BR-12], [FR-PLAT-4]).
 */

import type { Express } from "express";
import { asc } from "drizzle-orm";
import { z } from "zod";

import { isRedundantEquivalence, normalizeOem } from "@shared/oem";
import { FUEL_TYPES, vehicleBrands, vehicleModels } from "@shared/schema";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { asyncHandler } from "../../shared/http/handler";
import { authOf, authorize, requireAuth, requireModule } from "../../domains/auth/guards";
import {
  autoPartsRepository,
  manufacturersRepository,
  oemEquivalencesRepository,
  partCompatRepository,
  vehicleBrandsRepository,
  vehicleEnginesRepository,
  vehicleGenerationsRepository,
  vehicleModelsRepository,
} from "./repository";

const manufacturerSchema = z.object({
  name: z.string().min(1, "Le nom est obligatoire").max(150),
  countryId: z.string().uuid().nullish(),
  website: z.string().max(255).default(""),
});

const brandSchema = z.object({ name: z.string().min(1).max(100) });

const modelSchema = z.object({
  brandId: z.string().uuid(),
  name: z.string().min(1).max(100),
});

const generationSchema = z.object({
  modelId: z.string().uuid(),
  name: z.string().min(1).max(100),
  yearStart: z.number().int().min(1900).max(2100),
  yearEnd: z.number().int().min(1900).max(2100).nullish(),
});

const engineSchema = z.object({
  generationId: z.string().uuid(),
  code: z.string().min(1).max(50),
  label: z.string().max(100).default(""),
  fuel: z.enum(FUEL_TYPES).default("DIESEL"),
  displacement: z.number().int().min(0).max(20_000).nullish(),
});

const equivalenceSchema = z.object({
  refA: z.string().min(1, "Référence obligatoire").max(64),
  refB: z.string().min(1, "Référence obligatoire").max(64),
  relationType: z.enum(["OEM_OEM", "OEM_AFTERMARKET"]).default("OEM_OEM"),
  source: z.string().max(100).default(""),
  note: z.string().max(255).default(""),
});

const compatSchema = z.object({
  productId: z.string().uuid(),
  modelId: z.string().uuid(),
  generationId: z.string().uuid().nullish(),
  engineId: z.string().uuid().nullish(),
  note: z.string().max(255).default(""),
});

const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });

const guards = [requireAuth, requireModule("auto_parts")] as const;
const canRead = authorize({ anyPermission: ["auto_parts.read", "catalog.read"] });
const canWrite = authorize({ anyPermission: ["auto_parts.write", "catalog.write"] });

export function registerAutoPartsRoutes(app: Express): void {
  const base = "/api/modules/auto-parts";

  // --- Référentiels globaux ------------------------------------------------
  app.get(
    `${base}/countries`,
    ...guards,
    canRead,
    asyncHandler(async (_req, res) => {
      res.json(await autoPartsRepository.listCountries());
    })
  );

  app.get(
    `${base}/quality-levels`,
    ...guards,
    canRead,
    asyncHandler(async (_req, res) => {
      res.json(await autoPartsRepository.listQualityLevels());
    })
  );

  // --- Fabricants ----------------------------------------------------------
  app.get(
    `${base}/manufacturers`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(await manufacturersRepository.listAll(authOf(req).companyId));
    })
  );

  app.post(
    `${base}/manufacturers`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const data = manufacturerSchema.parse(req.body);
      res.status(201).json(await manufacturersRepository.create(authOf(req).companyId, data));
    })
  );

  app.patch(
    `${base}/manufacturers/:id`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const data = manufacturerSchema.partial().parse(req.body);
      const manufacturer = await manufacturersRepository.update(authOf(req).companyId, id, data);
      if (!manufacturer) throw new NotFoundError("Fabricant introuvable.");
      res.json(manufacturer);
    })
  );

  app.delete(
    `${base}/manufacturers/:id`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const archived = await manufacturersRepository.archive(authOf(req).companyId, id);
      if (!archived) throw new NotFoundError("Fabricant introuvable.");
      res.json({ success: true });
    })
  );

  // --- Hiérarchie véhicule (4 niveaux) -------------------------------------
  app.get(
    `${base}/vehicles`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(await autoPartsRepository.vehicleTree(authOf(req).companyId));
    })
  );

  app.get(
    `${base}/vehicle-brands`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(
        await vehicleBrandsRepository.listAll(authOf(req).companyId, {
          orderBy: [asc(vehicleBrands.name)],
        })
      );
    })
  );

  app.post(
    `${base}/vehicle-brands`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await vehicleBrandsRepository.create(authOf(req).companyId, brandSchema.parse(req.body))
        );
    })
  );

  app.get(
    `${base}/vehicle-models`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(
        await vehicleModelsRepository.listAll(authOf(req).companyId, {
          orderBy: [asc(vehicleModels.name)],
        })
      );
    })
  );

  app.post(
    `${base}/vehicle-models`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const data = modelSchema.parse(req.body);
      await vehicleBrandsRepository.requireById(authOf(req).companyId, data.brandId);
      res.status(201).json(await vehicleModelsRepository.create(authOf(req).companyId, data));
    })
  );

  app.post(
    `${base}/vehicle-generations`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const data = generationSchema.parse(req.body);
      if (data.yearEnd != null && data.yearEnd < data.yearStart) {
        throw new BusinessRuleError("L'année de fin doit être postérieure à l'année de début.");
      }
      await vehicleModelsRepository.requireById(authOf(req).companyId, data.modelId);
      res.status(201).json(await vehicleGenerationsRepository.create(authOf(req).companyId, data));
    })
  );

  app.post(
    `${base}/vehicle-engines`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const data = engineSchema.parse(req.body);
      await vehicleGenerationsRepository.requireById(authOf(req).companyId, data.generationId);
      res.status(201).json(await vehicleEnginesRepository.create(authOf(req).companyId, data));
    })
  );

  // --- Équivalences OEM ----------------------------------------------------
  app.get(
    `${base}/equivalences`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      const reference = typeof req.query.reference === "string" ? req.query.reference : undefined;
      res.json(await autoPartsRepository.listEquivalences(authOf(req).companyId, reference));
    })
  );

  app.post(
    `${base}/equivalences`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const data = equivalenceSchema.parse(req.body);
      const companyId = authOf(req).companyId;
      if (normalizeOem(data.refA) === normalizeOem(data.refB)) {
        throw new BusinessRuleError("Une référence ne peut pas être équivalente à elle-même.");
      }
      // Une équivalence déjà impliquée par transitivité n'apporte rien et densifie
      // inutilement le graphe ([FR-XREF-4]).
      const edges = await autoPartsRepository.listEquivalenceEdges(companyId);
      if (isRedundantEquivalence(data.refA, data.refB, edges)) {
        throw new BusinessRuleError(
          "Ces références sont déjà équivalentes (directement ou par transitivité).",
          "EQUIVALENCE_REDUNDANT"
        );
      }
      res.status(201).json(await autoPartsRepository.insertEquivalence(companyId, data));
    })
  );

  app.delete(
    `${base}/equivalences/:id`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const archived = await oemEquivalencesRepository.archive(authOf(req).companyId, id);
      if (!archived) throw new NotFoundError("Équivalence introuvable.");
      res.json({ success: true });
    })
  );

  /** Recherche par OEM avec fermeture transitive des équivalences ([FR-SRCH-2]). */
  app.get(
    `${base}/search`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      const reference = String(req.query.reference ?? "").trim();
      if (!reference) {
        throw new BusinessRuleError("Indiquez une référence OEM à rechercher.");
      }
      res.json(await autoPartsRepository.searchByOem(authOf(req).companyId, reference));
    })
  );

  // --- Compatibilité produit ↔ véhicule ------------------------------------
  app.get(
    `${base}/products/:id/compatibilities`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      res.json(await autoPartsRepository.listCompatibilities(authOf(req).companyId, id));
    })
  );

  app.post(
    `${base}/compatibilities`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const data = compatSchema.parse(req.body);
      const companyId = authOf(req).companyId;
      await vehicleModelsRepository.requireById(companyId, data.modelId);
      if (data.generationId) {
        await vehicleGenerationsRepository.requireById(companyId, data.generationId);
      }
      if (data.engineId) {
        await vehicleEnginesRepository.requireById(companyId, data.engineId);
      }
      res.status(201).json(await partCompatRepository.create(companyId, data));
    })
  );

  app.delete(
    `${base}/compatibilities/:id`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const archived = await partCompatRepository.archive(authOf(req).companyId, id);
      if (!archived) throw new NotFoundError("Compatibilité introuvable.");
      res.json({ success: true });
    })
  );
}
