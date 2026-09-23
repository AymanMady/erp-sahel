/** Contrats de validation du stock. */

import { z } from "zod";

import { MOVEMENT_DIRECTIONS, MOVEMENT_TYPES } from "@shared/schema";

export const listStockQuerySchema = z.object({
  warehouseId: z.string().uuid().nullish(),
  productId: z.string().uuid().nullish(),
  search: z.string().trim().max(200).optional(),
  lowStockOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const listMovementsQuerySchema = z.object({
  productId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid().nullish(),
  originType: z.string().max(40).nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createMovementSchema = z.object({
  productId: z.string().uuid("Sélectionnez un produit"),
  warehouseId: z.string().uuid("Sélectionnez un magasin"),
  movementType: z.enum(MOVEMENT_TYPES),
  direction: z.enum(MOVEMENT_DIRECTIONS).optional(),
  quantity: z.union([z.number().positive(), z.string()]),
  unitCostCents: z.number().int().min(0).default(0),
  lotNumber: z.string().max(64).default(""),
  reason: z.string().max(255).default(""),
  reference: z.string().max(100).default(""),
  /** Autorise explicitement un solde négatif (correction exceptionnelle). */
  allowNegative: z.boolean().default(false),
});

export const transferSchema = z.object({
  productId: z.string().uuid(),
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  quantity: z.union([z.number().positive(), z.string()]),
  lotNumber: z.string().max(64).optional(),
  reason: z.string().max(255).optional(),
});

export const createWarehouseSchema = z.object({
  code: z.string().min(1, "Le code est obligatoire").max(64),
  name: z.string().min(1, "Le nom est obligatoire").max(255),
  address: z.string().max(1000).default(""),
  isDefault: z.boolean().default(false),
});

export const updateWarehouseSchema = createWarehouseSchema.partial();

export const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });
