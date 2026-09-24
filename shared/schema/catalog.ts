/**
 * Catalogue **générique** : un même modèle de produit sert tout type de commerce.
 *
 * Ce qui distingue les articles (taille, couleur, référence constructeur…) passe par
 * les **variantes** et leurs attributs libres. Le code-barres est un attribut
 * **indexé, jamais la clé** ([BR-1]).
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
  name: (s) => s.min(1, "Le nom de la catégorie est obligatoire"),
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
    /** Domaine du profil 1–1 attaché ; `GENERIC` = aucun module. */
    /** Colonne historique (anciens modules métier) : toujours « GENERIC », non lue. */
    profileType: text("profile_type").default("GENERIC").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    unit: text("unit").default("unité").notNull(),
    /** Code-barres principal (EAN) — critère de recherche [FR-SRCH-1]. */
    barcode: text("barcode").default("").notNull(),
    purchasePriceCents: moneyCents("purchase_price_cents").default(0).notNull(),
    salePriceCents: moneyCents("sale_price_cents").default(0).notNull(),
    vatRateBp: rateBp("vat_rate_bp").default(0).notNull(),
    /** Article non stocké (main d'œuvre, prestation) [FR-PROD-5]. */
    isService: boolean("is_service").default(false).notNull(),
    /** Photo principale, affichée en priorité en recherche [FR-PROD-6]. */
    imageUrl: text("image_url"),
    /** Photos secondaires. */
    imageUrls: jsonb("image_urls").$type<string[]>().default([]).notNull(),
    /** Seuil d'alerte de réapprovisionnement [FR-STK-5]. */
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
  sku: (s) => s.min(1, "La référence interne est obligatoire"),
  name: (s) => s.min(1, "La désignation est obligatoire"),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

/**
 * Déclinaison vendable et stockable.
 * Ex. : taille × couleur pour un vêtement, conditionnement pour un produit alimentaire.
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
    /** Attributs libres du domaine (`{ size: "M", color: "Rouge" }`). */
    attributes: jsonb("attributes").$type<Record<string, string>>().default({}).notNull(),
    /** Surcharge de prix ; `null` ⇒ prix du produit. */
    salePriceCents: moneyCents("sale_price_cents"),
    isDefault: boolean("is_default").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("uq_variants_product_sku").on(table.productId, table.sku),
    index("idx_variants_barcode").on(table.barcode),
  ]
);

export type ProductVariant = typeof productVariants.$inferSelect;

/** Définition d'attribut typé déclarée par un module (EAV léger) [FR-PLUG-1]. */
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
 * Association produit ↔ fournisseur avec prix d'achat, délai et pays de provenance
 * (le pays peut différer du pays d'origine de la pièce) [FR-ACH-1].
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
    /** Code ISO 2 du pays de provenance chez ce fournisseur. */
    originCountryCode: text("origin_country_code").default("").notNull(),
    isPreferred: boolean("is_preferred").default(false).notNull(),
  },
  (table) => [uniqueIndex("uq_product_suppliers").on(table.productId, table.supplierId)]
);

export type ProductSupplier = typeof productSuppliers.$inferSelect;
