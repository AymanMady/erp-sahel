/** API du module Vêtements : grilles de tailles et génération des déclinaisons. */

import type { Express } from "express";
import { asc } from "drizzle-orm";
import { z } from "zod";

import { sizeGrids } from "@shared/schema";
import { slugify } from "@shared/format";
import { runInTransaction } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { asyncHandler } from "../../shared/http/handler";
import { TenantRepository } from "../../shared/db/tenant-repository";
import { authOf, authorize, requireAuth, requireModule } from "../../domains/auth/guards";
import { catalogRepository } from "../../domains/catalog/repository";

export const sizeGridsRepository = new TenantRepository(sizeGrids, [sizeGrids.name]);

const sizeGridSchema = z.object({
  name: z.string().min(1, "Le nom est obligatoire").max(150),
  sizes: z.array(z.string().min(1).max(20)).min(1, "Indiquez au moins une taille"),
});

const generateVariantsSchema = z.object({
  productId: z.string().uuid(),
  sizes: z.array(z.string().min(1).max(20)).min(1),
  colors: z.array(z.string().min(1).max(40)).min(1),
  /** Surcharge de prix appliquée à toutes les déclinaisons générées. */
  salePriceCents: z.number().int().min(0).nullish(),
});

const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });

const guards = [requireAuth, requireModule("clothing")] as const;
const canRead = authorize({ anyPermission: ["clothing.read", "catalog.read"] });
const canWrite = authorize({ anyPermission: ["clothing.write", "catalog.write"] });

export function registerClothingRoutes(app: Express): void {
  const base = "/api/modules/clothing";

  app.get(
    `${base}/size-grids`,
    ...guards,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(
        await sizeGridsRepository.listAll(authOf(req).companyId, {
          orderBy: [asc(sizeGrids.name)],
        })
      );
    })
  );

  app.post(
    `${base}/size-grids`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await sizeGridsRepository.create(authOf(req).companyId, sizeGridSchema.parse(req.body))
        );
    })
  );

  app.patch(
    `${base}/size-grids/:id`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const grid = await sizeGridsRepository.update(
        authOf(req).companyId,
        id,
        sizeGridSchema.partial().parse(req.body)
      );
      if (!grid) throw new NotFoundError("Grille de tailles introuvable.");
      res.json(grid);
    })
  );

  app.delete(
    `${base}/size-grids/:id`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const archived = await sizeGridsRepository.archive(authOf(req).companyId, id);
      if (!archived) throw new NotFoundError("Grille de tailles introuvable.");
      res.json({ success: true });
    })
  );

  /**
   * Génère le produit cartésien taille × couleur en variantes du noyau.
   * Chaque combinaison reçoit une référence dérivée du SKU produit, de sorte que le
   * code-barres et le stock puissent être gérés par déclinaison ([§4.0-bis SRS]).
   */
  app.post(
    `${base}/generate-variants`,
    ...guards,
    canWrite,
    asyncHandler(async (req, res) => {
      const data = generateVariantsSchema.parse(req.body);
      const companyId = authOf(req).companyId;
      const product = await catalogRepository.findById(companyId, data.productId);
      if (!product) throw new NotFoundError("Produit introuvable.");

      const variants = data.sizes.flatMap((size) =>
        data.colors.map((color) => ({
          sku: `${product.sku}-${slugify(size).toUpperCase()}-${slugify(color).toUpperCase()}`,
          barcode: "",
          attributes: { size, color },
          salePriceCents: data.salePriceCents ?? null,
          isDefault: false,
        }))
      );

      await runInTransaction((tx) =>
        catalogRepository.withTransaction(tx).replaceVariants(tx, companyId, product.id, variants)
      );
      res.status(201).json({ created: variants.length, variants });
    })
  );
}
