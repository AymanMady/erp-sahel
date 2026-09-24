/**
 * Multi-axis stock: store → location → lot, for a given product/variant
 * ([FR-STK-1], [BR-9]). Two items with the same reference but from different suppliers
 * are two distinct products, hence two distinct stocks ([BR-2], [FR-STK-2]).
 *
 * **The `inventory` domain is the sole owner of stock state**: no other layer writes
 * `stock_items` or `stock_movements` (architecture rule, see `server/ARCHITECTURE.md`).
 * Sales, purchasing and POS delegate to `inventoryApplication`.
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

/** Aisle / zone / precise location inside a store [FR-STK-1]. */
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
 * Stock balance for a combination of axes.
 * `quantity` is **derived** from movements: it is recomputed in the same transaction
 * as the movement insertion, never written blindly ([FR-STK-4]).
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
    /** Optional lot (Q5). */
    lotNumber: text("lot_number").default("").notNull(),
    quantity: quantity("quantity").default("0").notNull(),
    reservedQuantity: quantity("reserved_quantity").default("0").notNull(),
    /** Weighted average unit cost, for stock valuation [FR-RPT-1]. */
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
 * Movement direction, kept separate from its type.
 * `quantity` always stays positive: `direction` tells whether the balance goes up or
 * down. Without this column, an inventory adjustment (which can go either way) would
 * require storing negative quantities, and the running total of movements would no
 * longer be readable as is.
 */
export const MOVEMENT_DIRECTIONS = ["IN", "OUT"] as const;
export type MovementDirection = (typeof MOVEMENT_DIRECTIONS)[number];

/** Natural direction of a movement type; `ADJUSTMENT` and `TRANSFER` state it explicitly. */
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

/** Movement log: the only auditable source of truth for stock [FR-STK-3]. */
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
    /** Always positive: the direction is carried by `direction`. */
    quantity: quantity("quantity").notNull(),
    /** Balance of the axis after applying the movement (audit trail). */
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

/** Physical inventory: count, then adjustment postings [FR-STK-6]. */
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
