/**
 * Séquences de numérotation légale des documents ([FR-VNT-7], Q6).
 *
 * Une séquence par société **et par exercice** : `FAC-2026-0001`. L'allocation se fait
 * côté serveur, dans la transaction du document, par `UPDATE ... RETURNING` sur la ligne
 * verrouillée — deux postes hors-ligne ne peuvent donc pas produire le même numéro
 * (`SYNC_STRATEGY.md` §6). Hors ligne, le client affiche un numéro provisoire `OFFLINE-n`
 * qui est remplacé à l'ACK de synchronisation.
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

/** Préfixe affiché par type de document (français, cohérent avec l'ERP d'origine). */
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
    /** Exercice de la séquence (année civile ou exercice décalé). */
    year: integer("year").notNull(),
    lastNumber: integer("last_number").default(0).notNull(),
    prefix: text("prefix").default("").notNull(),
  },
  (table) => [
    uniqueIndex("uq_document_sequences").on(table.companyId, table.documentType, table.year),
  ]
);

export type DocumentSequence = typeof documentSequences.$inferSelect;

/** Format d'un numéro alloué : `PREFIX-ANNÉE-0001`. */
export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

/** Numéro provisoire visible hors ligne, remplacé à l'ingestion (`SYNC_STRATEGY.md` §6). */
export function formatProvisionalNumber(prefix: string, localSeq: number): string {
  return `OFFLINE-${prefix}-${String(localSeq).padStart(4, "0")}`;
}

/** Vrai si le numéro est encore provisoire (document non synchronisé). */
export function isProvisionalNumber(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("OFFLINE-");
}
