/** Catalog validation contracts. */

import { z } from "zod";

export const productSearchQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  categoryId: z.string().uuid().nullish(),
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
});

export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;

const variantSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().min(1, "Variant SKU is required").max(64),
  barcode: z.string().max(64).default(""),
  attributes: z.record(z.string()).default({}),
  salePriceCents: z.number().int().nullish(),
  isDefault: z.boolean().default(false),
});

export const createProductSchema = z.object({
  sku: z.string().min(1, "Internal SKU is required").max(64),
  name: z.string().min(1, "Product name is required").max(255),
  description: z.string().max(4000).default(""),
  categoryId: z.string().uuid().nullish(),
  /** Defaults to the translated "unit" at creation time (see the application layer). */
  unit: z.string().max(32).optional(),
  barcode: z.string().max(64).default(""),
  purchasePriceCents: z.number().int().min(0).default(0),
  salePriceCents: z.number().int().min(0).default(0),
  vatRateBp: z.number().int().min(0).max(10_000).default(0),
  isService: z.boolean().default(false),
  imageUrl: z.string().max(2000).nullish(),
  imageUrls: z.array(z.string().max(2000)).default([]),
  minStock: z.union([z.number(), z.string()]).default("0"),
  variants: z.array(variantSchema).default([]),
  /** Initial stock, entered at creation to avoid a second screen. */
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
  name: z.string().min(1, "Name is required").max(150),
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

export const idParamSchema = z.object({ id: z.string().uuid("Invalid identifier") });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
