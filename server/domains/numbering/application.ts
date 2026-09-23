/**
 * Allocation des numéros légaux de documents ([FR-VNT-7], `SYNC_STRATEGY.md` §6).
 *
 * L'allocation se fait **dans la transaction du document** par un `INSERT … ON CONFLICT
 * DO UPDATE … RETURNING` : la ligne de séquence est verrouillée le temps de l'incrément,
 * donc deux requêtes concurrentes — y compris deux lots de synchronisation venant de
 * deux postes — ne peuvent pas obtenir le même numéro. C'est précisément ce qui rend
 * sûre l'attribution du numéro définitif au moment de l'ingestion hors-ligne.
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
 * Exercice d'une date selon le mois de début d'exercice de la société.
 * Exercice décalé (ex. démarrant en juillet) : une facture de mars 2026 appartient
 * à l'exercice 2025, ce qui doit se refléter dans le numéro.
 */
export function fiscalYearOf(date: Date, fiscalYearStartMonth: number): number {
  const month = date.getMonth() + 1;
  return month >= fiscalYearStartMonth ? date.getFullYear() : date.getFullYear() - 1;
}

class NumberingApplication {
  /**
   * Alloue le prochain numéro pour un type de document.
   * `tx` doit être la transaction du document : si celle-ci échoue, le numéro
   * n'est pas consommé.
   */
  async allocate(
    tx: Database,
    input: {
      companyId: string;
      documentType: DocumentType;
      /** Date du document ; détermine l'exercice de la séquence. */
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

  /** Raccourci quand la société est déjà chargée (cas le plus fréquent). */
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

  /** État des séquences, pour l'écran de paramétrage. */
  async listSequences(companyId: string, database: Database = db) {
    return database
      .select()
      .from(documentSequences)
      .where(sql`${documentSequences.companyId} = ${companyId}`)
      .orderBy(documentSequences.documentType, documentSequences.year);
  }
}

export const numberingApplication = new NumberingApplication();
