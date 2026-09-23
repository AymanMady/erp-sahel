/**
 * Facturation client et avoirs.
 *
 * Invariants :
 *  - la **validation** d'une facture décrémente le stock ([FR-VNT-3], [BR-6]) et produit
 *    une écriture comptable équilibrée ([BR-7]) ;
 *  - une facture validée est **inaltérable** : `is_locked` passe à `true` et toute
 *    correction passe par un avoir ([BR-10], [FR-VNT-6]).
 */

import { boolean, date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { baseColumns, clientUuid, moneyCents, rateBp } from "./_base";
import { users } from "./accounts";
import { products } from "./catalog";
import { warehouses } from "./inventory";
import { parties } from "./parties";
import { documentLineColumns, salesOrders } from "./sales";
import { services } from "./services";
import { companies } from "./tenancy";

export const INVOICE_STATUSES = [
  "DRAFT",
  "VALIDATED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_SOURCES = ["MANUAL", "ORDER", "POS"] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];

export const salesInvoices = pgTable(
  "sales_invoices",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id, { onDelete: "set null" }),
    /** Magasin qui livre — détermine les axes de décrément du stock. */
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, { onDelete: "set null" }),
    source: text("source").$type<InvoiceSource>().default("MANUAL").notNull(),
    /** Session de caisse d'origine pour un ticket POS [FR-POS-2]. */
    posSessionId: uuid("pos_session_id"),
    date: date("date").notNull(),
    dueDate: date("due_date"),
    status: text("status").$type<InvoiceStatus>().default("DRAFT").notNull(),
    globalDiscountBp: rateBp("global_discount_bp").default(0).notNull(),
    totalHtCents: moneyCents("total_ht_cents").default(0).notNull(),
    totalVatCents: moneyCents("total_vat_cents").default(0).notNull(),
    totalTtcCents: moneyCents("total_ttc_cents").default(0).notNull(),
    paidAmountCents: moneyCents("paid_amount_cents").default(0).notNull(),
    currency: text("currency").default("MRU").notNull(),
    notes: text("notes").default("").notNull(),
    /** Document figé après validation — aucune modification possible [BR-10]. */
    isLocked: boolean("is_locked").default(false).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Numéro provisoire porté par le poste hors ligne avant l'ACK (`SYNC_STRATEGY.md` §6). */
    provisionalNumber: text("provisional_number").default("").notNull(),
    clientUuid: clientUuid(),
  },
  (table) => [
    uniqueIndex("uq_sales_invoices_company_number").on(table.companyId, table.number),
    uniqueIndex("uq_sales_invoices_client_uuid").on(table.clientUuid),
    index("idx_sales_invoices_company_date").on(table.companyId, table.date),
    index("idx_sales_invoices_party").on(table.partyId),
    index("idx_sales_invoices_status").on(table.companyId, table.status),
    index("idx_sales_invoices_pos_session").on(table.posSessionId),
  ]
);

export type SalesInvoice = typeof salesInvoices.$inferSelect;

export const salesInvoiceLines = pgTable(
  "sales_invoice_lines",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => salesInvoices.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id"),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    ...documentLineColumns,
  },
  (table) => [index("idx_sales_invoice_lines_invoice").on(table.invoiceId)]
);

export type SalesInvoiceLine = typeof salesInvoiceLines.$inferSelect;

export const CREDIT_NOTE_STATUSES = ["DRAFT", "VALIDATED", "CANCELLED"] as const;
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];

/** Avoir / retour : réintègre le stock et génère les écritures inverses [FR-VNT-6], [BR-6]. */
export const creditNotes = pgTable(
  "credit_notes",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    invoiceId: uuid("invoice_id").references(() => salesInvoices.id, { onDelete: "set null" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    status: text("status").$type<CreditNoteStatus>().default("DRAFT").notNull(),
    reason: text("reason").default("").notNull(),
    /** `true` si les articles reviennent physiquement en stock. */
    restock: boolean("restock").default(true).notNull(),
    totalHtCents: moneyCents("total_ht_cents").default(0).notNull(),
    totalVatCents: moneyCents("total_vat_cents").default(0).notNull(),
    totalTtcCents: moneyCents("total_ttc_cents").default(0).notNull(),
    currency: text("currency").default("MRU").notNull(),
    isLocked: boolean("is_locked").default(false).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    clientUuid: clientUuid(),
  },
  (table) => [
    uniqueIndex("uq_credit_notes_company_number").on(table.companyId, table.number),
    uniqueIndex("uq_credit_notes_client_uuid").on(table.clientUuid),
    index("idx_credit_notes_invoice").on(table.invoiceId),
  ]
);

export type CreditNote = typeof creditNotes.$inferSelect;

export const creditNoteLines = pgTable(
  "credit_note_lines",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    creditNoteId: uuid("credit_note_id")
      .notNull()
      .references(() => creditNotes.id, { onDelete: "cascade" }),
    invoiceLineId: uuid("invoice_line_id").references(() => salesInvoiceLines.id, {
      onDelete: "set null",
    }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id"),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    ...documentLineColumns,
  },
  (table) => [index("idx_credit_note_lines_note").on(table.creditNoteId)]
);

export type CreditNoteLine = typeof creditNoteLines.$inferSelect;
