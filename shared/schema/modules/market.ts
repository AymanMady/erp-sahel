/**
 * Module **Market** (V3) — marchandise généraliste, poids/volume et péremption.
 *
 * La péremption s'appuie sur les **lots** du noyau (`stock_items.lot_number`) : ce module
 * ajoute uniquement la DLC et la catégorie de taxe, sans dupliquer la gestion de stock
 * ([BR-14], Q5).
 */

import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { baseColumns, quantity } from "../_base";
import { products } from "../catalog";
import { warehouses } from "../inventory";
import { companies } from "../tenancy";

export const MEASURE_UNITS = ["UNITE", "KG", "G", "L", "ML", "M", "CM", "PAQUET"] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

export const marketProfiles = pgTable(
  "mk_profiles",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    brand: text("brand").default("").notNull(),
    measureUnit: text("measure_unit").$type<MeasureUnit>().default("UNITE").notNull(),
    weightGrams: integer("weight_grams").default(0).notNull(),
    volumeMl: integer("volume_ml").default(0).notNull(),
    taxCategory: text("tax_category").default("").notNull(),
    /** Active le suivi lot + DLC pour ce produit. */
    isPerishable: boolean("is_perishable").default(false).notNull(),
    /** Alerte N jours avant la DLC. */
    expiryAlertDays: integer("expiry_alert_days").default(30).notNull(),
  },
  (table) => [
    uniqueIndex("uq_mk_profiles_product").on(table.productId),
    index("idx_mk_profiles_brand").on(table.companyId, table.brand),
  ]
);

export type MarketProfile = typeof marketProfiles.$inferSelect;

/** Lot daté : porte la DLC. Le solde reste détenu par `stock_items` (même `lot_number`). */
export const productLots = pgTable(
  "mk_product_lots",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, { onDelete: "set null" }),
    lotNumber: text("lot_number").notNull(),
    expiryDate: date("expiry_date"),
    receivedQuantity: quantity("received_quantity").default("0").notNull(),
    supplierRef: text("supplier_ref").default("").notNull(),
  },
  (table) => [
    uniqueIndex("uq_mk_product_lots").on(table.companyId, table.productId, table.lotNumber),
    index("idx_mk_product_lots_expiry").on(table.companyId, table.expiryDate),
  ]
);

export type ProductLot = typeof productLots.$inferSelect;
