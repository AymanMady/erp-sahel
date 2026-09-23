/**
 * Module **Clothing** (V2) — profil vêtement et grilles de tailles.
 *
 * Les déclinaisons taille × couleur utilisent `product_variants.attributes`
 * (`{ size, color }`) du noyau : chaque combinaison a son code-barres et son stock
 * propres, sans nouvelle table de stock ([BR-14]).
 */

import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { baseColumns } from "../_base";
import { products } from "../catalog";
import { companies } from "../tenancy";

export const GENDERS = ["HOMME", "FEMME", "ENFANT", "MIXTE"] as const;
export type Gender = (typeof GENDERS)[number];

export const SEASONS = ["PRINTEMPS_ETE", "AUTOMNE_HIVER", "TOUTE_SAISON"] as const;
export type Season = (typeof SEASONS)[number];

/** Grille de tailles réutilisable (« EU 36-46 », « S-XXL »). */
export const sizeGrids = pgTable(
  "cl_size_grids",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Tailles ordonnées : l'ordre d'affichage des variantes en découle. */
    sizes: jsonb("sizes").$type<string[]>().default([]).notNull(),
  },
  (table) => [uniqueIndex("uq_cl_size_grids").on(table.companyId, table.name)]
);

export type SizeGrid = typeof sizeGrids.$inferSelect;

export const clothingProfiles = pgTable(
  "cl_profiles",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    brand: text("brand").default("").notNull(),
    gender: text("gender").$type<Gender>().default("MIXTE").notNull(),
    season: text("season").$type<Season>().default("TOUTE_SAISON").notNull(),
    material: text("material").default("").notNull(),
    collection: text("collection").default("").notNull(),
    sizeGridId: uuid("size_grid_id").references(() => sizeGrids.id, { onDelete: "set null" }),
    /** Couleurs déclinées, source des variantes taille × couleur. */
    colors: jsonb("colors").$type<string[]>().default([]).notNull(),
  },
  (table) => [
    uniqueIndex("uq_cl_profiles_product").on(table.productId),
    index("idx_cl_profiles_brand").on(table.companyId, table.brand),
    index("idx_cl_profiles_season").on(table.companyId, table.season),
  ]
);

export type ClothingProfile = typeof clothingProfiles.$inferSelect;
