/**
 * Purchasing: purchase order → goods receipt (stock entry) → supplier invoice
 * ([FR-ACH-2], [FR-ACH-3], [FR-ACH-4]).
 */

import { date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { baseColumns, clientUuid, moneyCents, quantity, rateBp } from "./_base";
import { users } from "./accounts";
import { products } from "./catalog";
import { warehouses } from "./inventory";
import { parties } from "./parties";
import { documentLineColumns } from "./sales";
import { companies } from "./tenancy";

export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => parties.id),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    expectedDate: date("expected_date"),
    status: text("status").$type<PurchaseOrderStatus>().default("DRAFT").notNull(),
    globalDiscountBp: rateBp("global_discount_bp").default(0).notNull(),
    totalHtCents: moneyCents("total_ht_cents").default(0).notNull(),
    totalVatCents: moneyCents("total_vat_cents").default(0).notNull(),
    totalTtcCents: moneyCents("total_ttc_cents").default(0).notNull(),
    currency: text("currency").default("MRU").notNull(),
    notes: text("notes").default("").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    clientUuid: clientUuid(),
  },
  (table) => [
    uniqueIndex("uq_purchase_orders_company_number").on(table.companyId, table.number),
    uniqueIndex("uq_purchase_orders_client_uuid").on(table.clientUuid),
    index("idx_purchase_orders_company_date").on(table.companyId, table.date),
  ]
);

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id"),
    /** Quantity already received — drives the transition to `PARTIALLY_RECEIVED`/`RECEIVED`. */
    receivedQuantity: quantity("received_quantity").default("0").notNull(),
    ...documentLineColumns,
  },
  (table) => [index("idx_purchase_order_lines_order").on(table.orderId)]
);

export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;

export const GOODS_RECEIPT_STATUSES = ["DRAFT", "VALIDATED", "CANCELLED"] as const;
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUSES)[number];

/** Goods receipt: validating it creates the stock-in movements [FR-ACH-3]. */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, {
      onDelete: "set null",
    }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => parties.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    date: date("date").notNull(),
    status: text("status").$type<GoodsReceiptStatus>().default("DRAFT").notNull(),
    notes: text("notes").default("").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    clientUuid: clientUuid(),
  },
  (table) => [
    uniqueIndex("uq_goods_receipts_company_number").on(table.companyId, table.number),
    uniqueIndex("uq_goods_receipts_client_uuid").on(table.clientUuid),
  ]
);

export type GoodsReceipt = typeof goodsReceipts.$inferSelect;

export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    purchaseOrderLineId: uuid("purchase_order_line_id").references(() => purchaseOrderLines.id, {
      onDelete: "set null",
    }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    variantId: uuid("variant_id"),
    lotNumber: text("lot_number").default("").notNull(),
    quantity: quantity("quantity").default("0").notNull(),
    unitCostCents: moneyCents("unit_cost_cents").default(0).notNull(),
  },
  (table) => [index("idx_goods_receipt_lines_receipt").on(table.receiptId)]
);

export type GoodsReceiptLine = typeof goodsReceiptLines.$inferSelect;

export const SUPPLIER_INVOICE_STATUSES = [
  "DRAFT",
  "VALIDATED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
] as const;
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number];

export const supplierInvoices = pgTable(
  "supplier_invoices",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    /** Reference of the document issued by the supplier (may differ from the internal number). */
    supplierReference: text("supplier_reference").default("").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => parties.id),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, {
      onDelete: "set null",
    }),
    receiptId: uuid("receipt_id").references(() => goodsReceipts.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    dueDate: date("due_date"),
    status: text("status").$type<SupplierInvoiceStatus>().default("DRAFT").notNull(),
    totalHtCents: moneyCents("total_ht_cents").default(0).notNull(),
    totalVatCents: moneyCents("total_vat_cents").default(0).notNull(),
    totalTtcCents: moneyCents("total_ttc_cents").default(0).notNull(),
    paidAmountCents: moneyCents("paid_amount_cents").default(0).notNull(),
    currency: text("currency").default("MRU").notNull(),
    notes: text("notes").default("").notNull(),
  },
  (table) => [
    uniqueIndex("uq_supplier_invoices_company_number").on(table.companyId, table.number),
    index("idx_supplier_invoices_supplier").on(table.supplierId),
  ]
);

export type SupplierInvoice = typeof supplierInvoices.$inferSelect;

export const supplierInvoiceLines = pgTable(
  "supplier_invoice_lines",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id"),
    ...documentLineColumns,
  },
  (table) => [index("idx_supplier_invoice_lines_invoice").on(table.invoiceId)]
);

export type SupplierInvoiceLine = typeof supplierInvoiceLines.$inferSelect;
