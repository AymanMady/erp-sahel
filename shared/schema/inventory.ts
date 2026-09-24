/**
 * Stock multi-critères : magasin → emplacement → lot, pour un produit/variante donné
 * ([FR-STK-1], [BR-9]). Deux articles de même référence mais de fournisseurs différents
 * sont deux produits distincts, donc deux stocks distincts ([BR-2], [FR-STK-2]).
 *
 * **Le domaine `inventory` est le seul propriétaire de l'état de stock** : aucune autre
 * couche n'écrit `stock_items` ni `stock_movements` (règle d'architecture, cf.
 * `server/ARCHITECTURE.md`). Les ventes, achats et POS délèguent à `inventoryApplication`.
 */

import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { baseColumns, clientUuid, moneyCents, quantity } from "./_base";
import { users } from "./accounts";
import { products, productVariants } from "./catalog";
import { companies } from "./tenancy";

export const warehouses = pgTable(
  "warehouses",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address").default("").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
  },
  (table) => [uniqueIndex("uq_warehouses_company_code").on(table.companyId, table.code)]
);

export const insertWarehouseSchema = createInsertSchema(warehouses, {
  code: (s) => s.min(1),
  name: (s) => s.min(1),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertWarehouse = z.infer<typeof insertWarehouseSchema>;
export type Warehouse = typeof warehouses.$inferSelect;

/** Rayon / zone / emplacement précis à l'intérieur d'un magasin [FR-STK-1]. */
export const stockLocations = pgTable(
  "stock_locations",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").default("").notNull(),
    zone: text("zone").default("").notNull(),
  },
  (table) => [uniqueIndex("uq_stock_locations").on(table.warehouseId, table.code)]
);

export type StockLocation = typeof stockLocations.$inferSelect;

/**
 * Solde de stock pour une combinaison d'axes.
 * `quantity` est **dérivé** des mouvements : il est recalculé dans la même transaction
 * que l'insertion du mouvement, jamais écrit à l'aveugle ([FR-STK-4]).
 */
export const stockItems = pgTable(
  "stock_items",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => stockLocations.id, { onDelete: "set null" }),
    /** Lot optionnel (Q5). */
    lotNumber: text("lot_number").default("").notNull(),
    quantity: quantity("quantity").default("0").notNull(),
    reservedQuantity: quantity("reserved_quantity").default("0").notNull(),
    /** Coût unitaire moyen pondéré, pour la valorisation du stock [FR-RPT-1]. */
    averageCostCents: moneyCents("average_cost_cents").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("uq_stock_items_axes").on(
      table.companyId,
      table.productId,
      table.warehouseId,
      table.lotNumber
    ),
    index("idx_stock_items_product").on(table.companyId, table.productId),
    index("idx_stock_items_warehouse").on(table.companyId, table.warehouseId),
  ]
);

export type StockItem = typeof stockItems.$inferSelect;

export const MOVEMENT_TYPES = ["IN", "OUT", "TRANSFER", "ADJUSTMENT", "RETURN"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Sens du mouvement, séparé de son type.
 * `quantity` reste toujours positive : c'est `direction` qui dit si le solde monte ou
 * descend. Sans cette colonne, un ajustement d'inventaire (qui peut aller dans les deux
 * sens) obligerait à stocker des quantités négatives, et le cumul des mouvements ne
 * serait plus lisible tel quel.
 */
export const MOVEMENT_DIRECTIONS = ["IN", "OUT"] as const;
export type MovementDirection = (typeof MOVEMENT_DIRECTIONS)[number];

/** Sens naturel d'un type de mouvement ; `ADJUSTMENT` et `TRANSFER` l'expriment explicitement. */
export function defaultDirection(movementType: MovementType): MovementDirection {
  return movementType === "IN" || movementType === "RETURN" ? "IN" : "OUT";
}

export const MOVEMENT_ORIGINS = [
  "purchase_receipt",
  "sales_invoice",
  "credit_note",
  "pos_ticket",
  "manual",
  "inventory_count",
  "transfer",
] as const;
export type MovementOrigin = (typeof MOVEMENT_ORIGINS)[number];

/** Journal des mouvements : la seule source de vérité auditable du stock [FR-STK-3]. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    stockItemId: uuid("stock_item_id")
      .notNull()
      .references(() => stockItems.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    movementType: text("movement_type").$type<MovementType>().notNull(),
    direction: text("direction").$type<MovementDirection>().notNull(),
    /** Toujours positive : le sens est porté par `direction`. */
    quantity: quantity("quantity").notNull(),
    /** Solde de l'axe après application du mouvement (piste d'audit). */
    balanceAfter: quantity("balance_after").default("0").notNull(),
    unitCostCents: moneyCents("unit_cost_cents").default(0).notNull(),
    originType: text("origin_type").$type<MovementOrigin>().default("manual").notNull(),
    originId: uuid("origin_id"),
    reference: text("reference").default("").notNull(),
    reason: text("reason").default("").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    clientUuid: clientUuid(),
  },
  (table) => [
    index("idx_stock_movements_company_created").on(table.companyId, table.createdAt),
    index("idx_stock_movements_product").on(table.companyId, table.productId),
    index("idx_stock_movements_origin").on(table.originType, table.originId),
    uniqueIndex("uq_stock_movements_client_uuid").on(table.clientUuid),
  ]
);

export type StockMovement = typeof stockMovements.$inferSelect;

export const INVENTORY_COUNT_STATUSES = ["DRAFT", "COUNTING", "VALIDATED", "CANCELLED"] as const;
export type InventoryCountStatus = (typeof INVENTORY_COUNT_STATUSES)[number];

/** Inventaire physique : comptage puis écritures d'ajustement [FR-STK-6]. */
export const inventoryCounts = pgTable("inventory_counts", {
  ...baseColumns,
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),
  date: timestamp("date", { withTimezone: true }).defaultNow().notNull(),
  status: text("status").$type<InventoryCountStatus>().default("DRAFT").notNull(),
  notes: text("notes").default("").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
});

export type InventoryCount = typeof inventoryCounts.$inferSelect;

export const inventoryCountLines = pgTable("inventory_count_lines", {
  ...baseColumns,
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  countId: uuid("count_id")
    .notNull()
    .references(() => inventoryCounts.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  stockItemId: uuid("stock_item_id").references(() => stockItems.id, { onDelete: "set null" }),
  expectedQuantity: quantity("expected_quantity").default("0").notNull(),
  countedQuantity: quantity("counted_quantity").default("0").notNull(),
});

export type InventoryCountLine = typeof inventoryCountLines.$inferSelect;
