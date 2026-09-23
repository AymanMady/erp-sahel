/**
 * Module **Auto Parts** — modèle de données propre, aucune table du noyau modifiée
 * ([BR-15], [FR-PLUG-2]).
 *
 *  - Référentiels globaux partagés : `countries`, `quality_levels`.
 *  - Référentiels tenant : `manufacturers` + hiérarchie véhicule à 4 niveaux [FR-VEH-1].
 *  - Profil produit 1–1 : `auto_part_profiles`, porteur de la référence OEM **indexée
 *    et non unique** ([BR-2]) — plusieurs articles peuvent partager la même OEM.
 *  - Compatibilité N–N : `part_vehicle_compat` ([BR-4]).
 *  - Équivalences symétriques : `oem_equivalences`, fermeture transitive calculée par
 *    le service ([BR-5], [FR-XREF-2]).
 */

import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { baseColumns } from "../_base";
import { products } from "../catalog";
import { companies } from "../tenancy";

export const countries = pgTable(
  "ap_countries",
  {
    ...baseColumns,
    code: text("code").notNull(),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("uq_ap_countries_code").on(table.code)]
);

export type Country = typeof countries.$inferSelect;

export const QUALITY_CODES = [
  "OEM",
  "GENUINE",
  "PREMIUM",
  "AFTERMARKET",
  "STANDARD",
  "ECONOMIQUE",
] as const;
export type QualityCode = (typeof QUALITY_CODES)[number];

export const qualityLevels = pgTable(
  "ap_quality_levels",
  {
    ...baseColumns,
    code: text("code").$type<QualityCode>().notNull(),
    label: text("label").notNull(),
    rank: integer("rank").default(0).notNull(),
  },
  (table) => [uniqueIndex("uq_ap_quality_levels_code").on(table.code)]
);

export type QualityLevel = typeof qualityLevels.$inferSelect;

/** Fabricant / équipementier (Bosch, Denso…), distinct de la marque véhicule [FR-FAB-1]. */
export const manufacturers = pgTable(
  "ap_manufacturers",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    countryId: uuid("country_id").references(() => countries.id, { onDelete: "set null" }),
    website: text("website").default("").notNull(),
  },
  (table) => [uniqueIndex("uq_ap_manufacturers").on(table.companyId, table.name)]
);

export type Manufacturer = typeof manufacturers.$inferSelect;

export const vehicleBrands = pgTable(
  "ap_vehicle_brands",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("uq_ap_vehicle_brands").on(table.companyId, table.name)]
);

export type VehicleBrand = typeof vehicleBrands.$inferSelect;

export const vehicleModels = pgTable(
  "ap_vehicle_models",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => vehicleBrands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("uq_ap_vehicle_models").on(table.companyId, table.brandId, table.name)]
);

export type VehicleModel = typeof vehicleModels.$inferSelect;

/** Génération bornée par années (Hilux 2016–2020) [FR-VEH-3]. */
export const vehicleGenerations = pgTable(
  "ap_vehicle_generations",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => vehicleModels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    yearStart: integer("year_start").notNull(),
    yearEnd: integer("year_end"),
  },
  (table) => [
    uniqueIndex("uq_ap_vehicle_generations").on(table.companyId, table.modelId, table.name),
  ]
);

export type VehicleGeneration = typeof vehicleGenerations.$inferSelect;

export const FUEL_TYPES = ["DIESEL", "ESSENCE", "HYBRID", "ELECTRIC", "GPL", "OTHER"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

/** Motorisation : code moteur rattaché à une génération [FR-VEH-4]. */
export const vehicleEngines = pgTable(
  "ap_vehicle_engines",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => vehicleGenerations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").default("").notNull(),
    fuel: text("fuel").$type<FuelType>().default("DIESEL").notNull(),
    /** Cylindrée en cm³. */
    displacement: integer("displacement"),
  },
  (table) => [
    uniqueIndex("uq_ap_vehicle_engines").on(table.companyId, table.generationId, table.code),
  ]
);

export type VehicleEngine = typeof vehicleEngines.$inferSelect;

/**
 * Profil « pièce auto » attaché 1–1 au produit générique [BR-11].
 * `oem_normalized` (casse, espaces et tirets retirés) sert la recherche insensible
 * à la ponctuation [FR-SRCH-4] et le rapprochement d'équivalences.
 */
export const autoPartProfiles = pgTable(
  "ap_part_profiles",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Référence constructeur : indexée, **non unique** [BR-2], [FR-PROD-2]. */
    oemReference: text("oem_reference").default("").notNull(),
    oemNormalized: text("oem_normalized").default("").notNull(),
    manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id, {
      onDelete: "set null",
    }),
    /** Pays d'origine obligatoire côté métier [BR-3] — nullable en base pour l'import progressif. */
    countryId: uuid("country_id").references(() => countries.id, { onDelete: "set null" }),
    qualityLevelId: uuid("quality_level_id").references(() => qualityLevels.id, {
      onDelete: "set null",
    }),
    manufacturerRef: text("manufacturer_ref").default("").notNull(),
    warrantyMonths: integer("warranty_months").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("uq_ap_part_profiles_product").on(table.productId),
    index("idx_ap_part_profiles_oem").on(table.companyId, table.oemNormalized),
    index("idx_ap_part_profiles_manufacturer").on(table.companyId, table.manufacturerId),
    index("idx_ap_part_profiles_country").on(table.companyId, table.countryId),
  ]
);

export type AutoPartProfile = typeof autoPartProfiles.$inferSelect;

/** Compatibilité N–N : cible le niveau non nul le plus fin (modèle, génération ou motorisation). */
export const partVehicleCompat = pgTable(
  "ap_part_vehicle_compat",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => vehicleModels.id, { onDelete: "cascade" }),
    generationId: uuid("generation_id").references(() => vehicleGenerations.id, {
      onDelete: "cascade",
    }),
    engineId: uuid("engine_id").references(() => vehicleEngines.id, { onDelete: "cascade" }),
    note: text("note").default("").notNull(),
  },
  (table) => [
    index("idx_ap_compat_product").on(table.companyId, table.productId),
    index("idx_ap_compat_model").on(table.companyId, table.modelId),
    index("idx_ap_compat_engine").on(table.companyId, table.engineId),
  ]
);

export type PartVehicleCompat = typeof partVehicleCompat.$inferSelect;

export const EQUIVALENCE_RELATIONS = ["OEM_OEM", "OEM_AFTERMARKET"] as const;
export type EquivalenceRelation = (typeof EQUIVALENCE_RELATIONS)[number];

/** Arête d'équivalence : la relation est symétrique, la transitivité est calculée [BR-5]. */
export const oemEquivalences = pgTable(
  "ap_oem_equivalences",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    refA: text("ref_a").notNull(),
    refB: text("ref_b").notNull(),
    normA: text("norm_a").notNull(),
    normB: text("norm_b").notNull(),
    relationType: text("relation_type").$type<EquivalenceRelation>().default("OEM_OEM").notNull(),
    source: text("source").default("").notNull(),
    note: text("note").default("").notNull(),
  },
  (table) => [
    uniqueIndex("uq_ap_oem_equivalences").on(table.companyId, table.normA, table.normB),
    index("idx_ap_oem_equivalences_a").on(table.companyId, table.normA),
    index("idx_ap_oem_equivalences_b").on(table.companyId, table.normB),
  ]
);

export type OemEquivalence = typeof oemEquivalences.$inferSelect;
