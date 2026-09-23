/** Devis et commandes de vente [FR-VNT-1], [FR-VNT-2]. */

import { date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { baseColumns, clientUuid, moneyCents, quantity, rateBp } from "./_base";
import { users } from "./accounts";
import { products } from "./catalog";
import { parties } from "./parties";
import { services } from "./services";
import { companies } from "./tenancy";

export const QUOTE_STATUSES = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CONVERTED",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const quotes = pgTable(
  "quotes",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    date: date("date").notNull(),
    expiryDate: date("expiry_date"),
    status: text("status").$type<QuoteStatus>().default("DRAFT").notNull(),
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
    uniqueIndex("uq_quotes_company_number").on(table.companyId, table.number),
    uniqueIndex("uq_quotes_client_uuid").on(table.clientUuid),
    index("idx_quotes_company_date").on(table.companyId, table.date),
    index("idx_quotes_party").on(table.partyId),
  ]
);

export type Quote = typeof quotes.$inferSelect;

/**
 * Colonnes communes à toutes les lignes de document commercial.
 * Les montants sont **recalculés serveur** par `computeDocumentTotals` : ce que la ligne
 * persiste est le résultat, jamais une saisie libre.
 */
const documentLineColumns = {
  description: text("description").notNull(),
  /** Référence produit figée : le document reste lisible si l'article est archivé. */
  productSku: text("product_sku").default("").notNull(),
  quantity: quantity("quantity").default("1").notNull(),
  unit: text("unit").default("unité").notNull(),
  unitPriceCents: moneyCents("unit_price_cents").default(0).notNull(),
  discountBp: rateBp("discount_bp").default(0).notNull(),
  vatRateBp: rateBp("vat_rate_bp").default(0).notNull(),
  totalHtCents: moneyCents("total_ht_cents").default(0).notNull(),
  totalVatCents: moneyCents("total_vat_cents").default(0).notNull(),
  totalTtcCents: moneyCents("total_ttc_cents").default(0).notNull(),
  position: integer("position").default(0).notNull(),
  /** Pays d'origine figé au moment du document — doit apparaître sur devis et facture [FR-VNT-5]. */
  originCountry: text("origin_country").default("").notNull(),
};

export const quoteLines = pgTable(
  "quote_lines",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id"),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    ...documentLineColumns,
  },
  (table) => [index("idx_quote_lines_quote").on(table.quoteId)]
);

export type QuoteLine = typeof quoteLines.$inferSelect;

export const SALES_ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "INVOICED",
  "CANCELLED",
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const salesOrders = pgTable(
  "sales_orders",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    quoteId: uuid("quote_id").references(() => quotes.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    deliveryDate: date("delivery_date"),
    status: text("status").$type<SalesOrderStatus>().default("DRAFT").notNull(),
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
    uniqueIndex("uq_sales_orders_company_number").on(table.companyId, table.number),
    uniqueIndex("uq_sales_orders_client_uuid").on(table.clientUuid),
    index("idx_sales_orders_company_date").on(table.companyId, table.date),
  ]
);

export type SalesOrder = typeof salesOrders.$inferSelect;

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id"),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    ...documentLineColumns,
  },
  (table) => [index("idx_sales_order_lines_order").on(table.orderId)]
);

export type SalesOrderLine = typeof salesOrderLines.$inferSelect;

export { documentLineColumns };
