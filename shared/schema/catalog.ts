/**
 * **Generic** catalog: a single product model serves every kind of business.
 *
 * What distinguishes items (size, color, manufacturer part number…) goes through
 * **variants** and their free-form attributes. The barcode is an **indexed attribute,
 * never the key** ([BR-1]).
 */

import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { baseColumns, clientUuid, moneyCents, quantity, rateBp } from "./_base";
import { companies } from "./tenancy";

export const categories = pgTable(
  "categories",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    description: text("description").default("").notNull(),
  },
  (table) => [index("idx_categories_company").on(table.companyId)]
);

export const insertCategorySchema = createInsertSchema(categories, {
  name: (s) => s.min(1, "Category name is required"),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

export const products = pgTable(
  "products",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Domain of the attached 1–1 profile; `GENERIC` = no module. */
    /** Legacy column (former business modules): always "GENERIC", never read. */
    profileType: text("profile_type").default("GENERIC").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    unit: text("unit").default("unité").notNull(),
    /** Main barcode (EAN) — search criterion [FR-SRCH-1]. */
    barcode: text("barcode").default("").notNull(),
    purchasePriceCents: moneyCents("purchase_price_cents").default(0).notNull(),
    salePriceCents: moneyCents("sale_price_cents").default(0).notNull(),
    vatRateBp: rateBp("vat_rate_bp").default(0).notNull(),
    /** Non-stock item (labor, service) [FR-PROD-5]. */
    isService: boolean("is_service").default(false).notNull(),
    /** Main photo, shown first in search results [FR-PROD-6]. */
    imageUrl: text("image_url"),
    /** Secondary photos. */
    imageUrls: jsonb("image_urls").$type<string[]>().default([]).notNull(),
    /** Reorder alert threshold [FR-STK-5]. */
    minStock: quantity("min_stock").default("0").notNull(),
    clientUuid: clientUuid(),
  },
  (table) => [
    uniqueIndex("uq_products_company_sku").on(table.companyId, table.sku),
    uniqueIndex("uq_products_client_uuid").on(table.clientUuid),
    index("idx_products_company_name").on(table.companyId, table.name),
    index("idx_products_barcode").on(table.barcode),
    index("idx_products_profile").on(table.companyId, table.profileType),
  ]
);

export const insertProductSchema = createInsertSchema(products, {
  sku: (s) => s.min(1, "Internal reference (SKU) is required"),
  name: (s) => s.min(1, "Product name is required"),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

/**
 * Sellable and stockable variant.
 * E.g. size × color for clothing, pack size for a food product.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    barcode: text("barcode").default("").notNull(),
    /** Free-form domain attributes (`{ size: "M", color: "Red" }`). */
    attributes: jsonb("attributes").$type<Record<string, string>>().default({}).notNull(),
    /** Price override; `null` ⇒ product price. */
    salePriceCents: moneyCents("sale_price_cents"),
    isDefault: boolean("is_default").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("uq_variants_product_sku").on(table.productId, table.sku),
    index("idx_variants_barcode").on(table.barcode),
  ]
);

export type ProductVariant = typeof productVariants.$inferSelect;

/** Typed attribute definition declared by a module (lightweight EAV) [FR-PLUG-1]. */
export const attributeDefinitions = pgTable(
  "attribute_definitions",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    moduleCode: text("module_code").notNull(),
    code: text("code").notNull(),
    label: text("label").default("").notNull(),
    dataType: text("data_type")
      .$type<"string" | "number" | "boolean" | "enum">()
      .default("string")
      .notNull(),
    choices: jsonb("choices").$type<string[]>().default([]).notNull(),
  },
  (table) => [
    uniqueIndex("uq_attribute_definitions").on(table.companyId, table.moduleCode, table.code),
  ]
);

export type AttributeDefinition = typeof attributeDefinitions.$inferSelect;

/**
 * Product ↔ supplier link with purchase price, lead time and country of shipment
 * (which may differ from the part's country of origin) [FR-ACH-1].
 */
export const productSuppliers = pgTable(
  "product_suppliers",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").notNull(),
    supplierRef: text("supplier_ref").default("").notNull(),
    purchasePriceCents: moneyCents("purchase_price_cents").default(0).notNull(),
    leadTimeDays: moneyCents("lead_time_days").default(0).notNull(),
    /** ISO alpha-2 code of the country this supplier ships from. */
    originCountryCode: text("origin_country_code").default("").notNull(),
    isPreferred: boolean("is_preferred").default(false).notNull(),
  },
  (table) => [uniqueIndex("uq_product_suppliers").on(table.productId, table.supplierId)]
);

export type ProductSupplier = typeof productSuppliers.$inferSelect;
