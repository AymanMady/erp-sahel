/**
 * Règlements clients et fournisseurs [FR-PAY-1].
 *
 * Un règlement confirmé produit toujours : l'imputation sur la facture, le mouvement
 * de trésorerie et l'écriture comptable ([FR-PAY-2], [BR-7]) — les trois dans la même
 * transaction, ou aucun des trois.
 */

import { date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { baseColumns, clientUuid, moneyCents } from "./_base";
import { users } from "./accounts";
import { bankAccounts } from "./banking";
import { salesInvoices } from "./invoicing";
import { parties } from "./parties";
import { supplierInvoices } from "./purchasing";
import { companies } from "./tenancy";

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CHECK", "CARD", "MOBILE_MONEY"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PENDING", "CONFIRMED", "REJECTED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Sens du flux : encaissement client (`IN`) ou décaissement fournisseur (`OUT`). */
export const PAYMENT_DIRECTIONS = ["IN", "OUT"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

export const payments = pgTable(
  "payments",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    direction: text("direction").$type<PaymentDirection>().default("IN").notNull(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    invoiceId: uuid("invoice_id").references(() => salesInvoices.id, { onDelete: "set null" }),
    supplierInvoiceId: uuid("supplier_invoice_id").references(() => supplierInvoices.id, {
      onDelete: "set null",
    }),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "set null",
    }),
    amountCents: moneyCents("amount_cents").notNull(),
    paymentDate: date("payment_date").notNull(),
    paymentMethod: text("payment_method").$type<PaymentMethod>().default("CASH").notNull(),
    reference: text("reference").default("").notNull(),
    status: text("status").$type<PaymentStatus>().default("CONFIRMED").notNull(),
    currency: text("currency").default("MRU").notNull(),
    notes: text("notes").default("").notNull(),
    posSessionId: uuid("pos_session_id"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    clientUuid: clientUuid(),
  },
  (table) => [
    uniqueIndex("uq_payments_company_number").on(table.companyId, table.number),
    uniqueIndex("uq_payments_client_uuid").on(table.clientUuid),
    index("idx_payments_company_date").on(table.companyId, table.paymentDate),
    index("idx_payments_invoice").on(table.invoiceId),
    index("idx_payments_party").on(table.partyId),
  ]
);

export type Payment = typeof payments.$inferSelect;
