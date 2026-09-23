/**
 * Aides de numérotation utilisables côté client **sans importer le schéma Drizzle**.
 *
 * `shared/schema/numbering.ts` tire `drizzle-orm/pg-core` : l'embarquer dans le bundle
 * navigateur alourdirait inutilement le POS. Ces fonctions y sont donc dupliquées à
 * l'identique, et le test `shared/__tests__/numbering.test.ts` vérifie qu'elles ne
 * divergent pas.
 */

/** Numéro provisoire visible hors ligne, remplacé par le numéro légal à l'ACK. */
export function formatProvisionalNumber(prefix: string, localSeq: number): string {
  return `OFFLINE-${prefix}-${String(localSeq).padStart(4, "0")}`;
}

/** Vrai si le numéro est encore provisoire (document non synchronisé). */
export function isProvisionalNumber(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("OFFLINE-");
}

/** Format d'un numéro alloué par le serveur : `PREFIX-ANNÉE-0001`. */
export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}
