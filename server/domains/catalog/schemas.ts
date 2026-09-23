/** Contrats de validation du catalogue. */

import { z } from "zod";

import { PROFILE_TYPES } from "@shared/schema";

export const productSearchQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  categoryId: z.string().uuid().nullish(),
  profileType: z.enum(PROFILE_TYPES).nullish(),
  isService: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .nullish(),
  includeArchived: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .optional(),
  withStock: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .optional(),
  orderBy: z.enum(["name", "sku", "price", "recent"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /**
   * Les critères des modules ne sont pas listés ici : ils sont relayés tels quels à
   * `buildSearchFilter` du plugin concerné, seul à connaître leur forme ([BR-17]).
   */
  oem: z.string().trim().max(64).optional(),
  manufacturerId: z.string().uuid().nullish(),
  countryId: z.string().uuid().nullish(),
  qualityLevelId: z.string().uuid().nullish(),
  vehicleModelId: z.string().uuid().nullish(),
  vehicleGenerationId: z.string().uuid().nullish(),
  vehicleEngineId: z.string().uuid().nullish(),
  brand: z.string().trim().max(100).optional(),
  gender: z.string().trim().max(20).optional(),
  season: z.string().trim().max(30).optional(),
  size: z.string().trim().max(20).optional(),
  color: z.string().trim().max(40).optional(),
  isPerishable: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .optional(),
});

export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;

const variantSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().min(1, "Référence de variante obligatoire").max(64),
  barcode: z.string().max(64).default(""),
  attributes: z.record(z.string()).default({}),
  salePriceCents: z.number().int().nullish(),
  isDefault: z.boolean().default(false),
});

export const createProductSchema = z.object({
  sku: z.string().min(1, "La référence interne est obligatoire").max(64),
  name: z.string().min(1, "La désignation est obligatoire").max(255),
  description: z.string().max(4000).default(""),
  profileType: z.enum(PROFILE_TYPES).default("GENERIC"),
  categoryId: z.string().uuid().nullish(),
  unit: z.string().max(32).default("unité"),
  barcode: z.string().max(64).default(""),
  purchasePriceCents: z.number().int().min(0).default(0),
  salePriceCents: z.number().int().min(0).default(0),
  vatRateBp: z.number().int().min(0).max(10_000).default(0),
  isService: z.boolean().default(false),
  imageUrl: z.string().max(2000).nullish(),
  imageUrls: z.array(z.string().max(2000)).default([]),
  minStock: z.union([z.number(), z.string()]).default("0"),
  variants: z.array(variantSchema).default([]),
  /** Profil du module correspondant à `profileType` — validé par le module lui-même. */
  profile: z.record(z.unknown()).nullish(),
  /** Stock initial, saisi à la création pour éviter un second écran. */
  initialStock: z
    .object({
      warehouseId: z.string().uuid(),
      quantity: z.union([z.number(), z.string()]),
      unitCostCents: z.number().int().min(0).default(0),
    })
    .nullish(),
});

export const updateProductSchema = createProductSchema.partial().omit({ initialStock: true });

export const createCategorySchema = z.object({
  name: z.string().min(1, "Le nom est obligatoire").max(150),
  parentId: z.string().uuid().nullish(),
  description: z.string().max(1000).default(""),
});

export const updateCategorySchema = createCategorySchema.partial();

export const productSupplierSchema = z.object({
  supplierId: z.string().uuid(),
  supplierRef: z.string().max(64).default(""),
  purchasePriceCents: z.number().int().min(0).default(0),
  leadTimeDays: z.number().int().min(0).max(365).default(0),
  originCountryCode: z.string().max(2).default(""),
  isPreferred: z.boolean().default(false),
});

export const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
