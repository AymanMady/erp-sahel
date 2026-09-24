/**
 * Legal document numbering sequences ([FR-VNT-7], Q6).
 *
 * One sequence per company **and per fiscal year**: `FAC-2026-0001`. Allocation happens
 * server-side, inside the document's transaction, via `UPDATE ... RETURNING` on the
 * locked row — so two offline workstations cannot produce the same number
 * (`SYNC_STRATEGY.md` §6). While offline, the client shows a provisional `OFFLINE-n`
 * number that is replaced on the sync ACK.
 */

import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { baseColumns } from "./_base";
import { companies } from "./tenancy";

export const DOCUMENT_TYPES = [
  "QUOTE",
  "SALES_ORDER",
  "SALES_INVOICE",
  "CREDIT_NOTE",
  "PURCHASE_ORDER",
  "GOODS_RECEIPT",
  "SUPPLIER_INVOICE",
  "PAYMENT",
  "JOURNAL_ENTRY",
  "INVENTORY_COUNT",
  "POS_TICKET",
  "PARTY",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Displayed prefix per document type (French abbreviations, consistent with the original ERP). */
export const DOCUMENT_PREFIXES: Record<DocumentType, string> = {
  QUOTE: "DEV",
  SALES_ORDER: "CMD",
  SALES_INVOICE: "FAC",
  CREDIT_NOTE: "AV",
  PURCHASE_ORDER: "ACH",
  GOODS_RECEIPT: "BR",
  SUPPLIER_INVOICE: "FF",
  PAYMENT: "REG",
  JOURNAL_ENTRY: "ECR",
  INVENTORY_COUNT: "INV",
  POS_TICKET: "TKT",
  PARTY: "TRS",
};

export const documentSequences = pgTable(
  "document_sequences",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentType: text("document_type").$type<DocumentType>().notNull(),
    /** Fiscal year of the sequence (calendar year or offset fiscal year). */
    year: integer("year").notNull(),
    lastNumber: integer("last_number").default(0).notNull(),
    prefix: text("prefix").default("").notNull(),
  },
  (table) => [
    uniqueIndex("uq_document_sequences").on(table.companyId, table.documentType, table.year),
  ]
);

export type DocumentSequence = typeof documentSequences.$inferSelect;

/** Format of an allocated number: `PREFIX-YEAR-0001`. */
export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

/** Provisional number visible offline, replaced on ingestion (`SYNC_STRATEGY.md` §6). */
export function formatProvisionalNumber(prefix: string, localSeq: number): string {
  return `OFFLINE-${prefix}-${String(localSeq).padStart(4, "0")}`;
}

/** True if the number is still provisional (document not yet synced). */
export function isProvisionalNumber(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("OFFLINE-");
}
