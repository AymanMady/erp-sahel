/**
 * Allocation of legal document numbers ([FR-VNT-7], `SYNC_STRATEGY.md` §6).
 *
 * Allocation happens **inside the document transaction** via an `INSERT … ON CONFLICT
 * DO UPDATE … RETURNING`: the sequence row is locked for the duration of the increment,
 * so two concurrent requests — including two sync batches coming from two terminals —
 * cannot obtain the same number. This is precisely what makes it safe to assign the
 * final number when offline operations are ingested.
 */

import { sql } from "drizzle-orm";

import {
  DOCUMENT_PREFIXES,
  documentSequences,
  formatDocumentNumber,
  type Company,
  type DocumentType,
} from "@shared/schema";
import { db, type Database } from "../../db";

/**
 * Fiscal year of a date according to the company's fiscal year start month.
 * With an offset fiscal year (e.g. starting in July), an invoice from March 2026
 * belongs to fiscal year 2025, which must be reflected in the number.
 */
export function fiscalYearOf(date: Date, fiscalYearStartMonth: number): number {
  const month = date.getMonth() + 1;
  return month >= fiscalYearStartMonth ? date.getFullYear() : date.getFullYear() - 1;
}

class NumberingApplication {
  /**
   * Allocates the next number for a document type.
   * `tx` must be the document transaction: if it fails, the number is not consumed.
   */
  async allocate(
    tx: Database,
    input: {
      companyId: string;
      documentType: DocumentType;
      /** Document date; determines the fiscal year of the sequence. */
      date?: Date | string;
      fiscalYearStartMonth?: number;
      prefix?: string;
    }
  ): Promise<string> {
    const date =
      input.date instanceof Date
        ? input.date
        : input.date
          ? new Date(`${String(input.date).slice(0, 10)}T00:00:00`)
          : new Date();
    const year = fiscalYearOf(
      Number.isNaN(date.getTime()) ? new Date() : date,
      input.fiscalYearStartMonth ?? 1
    );
    const prefix = input.prefix ?? DOCUMENT_PREFIXES[input.documentType];

    const [row] = await tx
      .insert(documentSequences)
      .values({
        companyId: input.companyId,
        documentType: input.documentType,
        year,
        prefix,
        lastNumber: 1,
      })
      .onConflictDoUpdate({
        target: [
          documentSequences.companyId,
          documentSequences.documentType,
          documentSequences.year,
        ],
        set: {
          lastNumber: sql`${documentSequences.lastNumber} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ lastNumber: documentSequences.lastNumber });

    return formatDocumentNumber(prefix, year, row.lastNumber);
  }

  /** Shortcut when the company is already loaded (the most common case). */
  async allocateForCompany(
    tx: Database,
    company: Pick<Company, "id" | "fiscalYearStartMonth">,
    documentType: DocumentType,
    date?: Date | string
  ): Promise<string> {
    return this.allocate(tx, {
      companyId: company.id,
      documentType,
      date,
      fiscalYearStartMonth: company.fiscalYearStartMonth,
    });
  }

  /** State of the sequences, for the settings screen. */
  async listSequences(companyId: string, database: Database = db) {
    return database
      .select()
      .from(documentSequences)
      .where(sql`${documentSequences.companyId} = ${companyId}`)
      .orderBy(documentSequences.documentType, documentSequences.year);
  }
}

export const numberingApplication = new NumberingApplication();
