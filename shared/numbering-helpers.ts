/**
 * Numbering helpers usable on the client **without importing the Drizzle schema**.
 *
 * `shared/schema/numbering.ts` pulls in `drizzle-orm/pg-core`: shipping it in the
 * browser bundle would needlessly bloat the POS. These functions are therefore
 * duplicated verbatim, and the `shared/__tests__/numbering.test.ts` test checks that
 * they do not diverge.
 */

/** Provisional number shown offline, replaced by the legal number on ACK. */
export function formatProvisionalNumber(prefix: string, localSeq: number): string {
  return `OFFLINE-${prefix}-${String(localSeq).padStart(4, "0")}`;
}

/** True if the number is still provisional (document not yet synchronized). */
export function isProvisionalNumber(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("OFFLINE-");
}

/** Format of a server-allocated number: `PREFIX-YEAR-0001`. */
export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}
