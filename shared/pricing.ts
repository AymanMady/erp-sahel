/**
 * Totals of commercial documents (quotes, orders, invoices, credit notes, POS receipts).
 *
 * Single source of truth shared client ⇄ server: the offline POS displays the same
 * amounts as those recomputed by the server on ingestion, which avoids the divergences
 * described in `SYNC_STRATEGY.md` §4 (the client produces intents, the server is
 * authoritative — but with the **same** formula).
 *
 * Rules ([FR-VNT-4], [BR-6]):
 *  1. line base        = quantity × unit price  (rounded to the cent)
 *  2. discounted base  = base − line discount (basis points)
 *  3. global discount  = spread pro rata over the discounted bases, the rounding
 *                        remainder going to the last line so that Σ lines = document total
 *  4. line total      = discounted base − share of the global discount
 *
 * No sales tax applies: the line total is the amount due.
 */

import { applyDiscount, applyRate, normalizeQuantity, roundHalfUp } from "./money";

/** A line as entered in the UI or received by the API. */
export interface PricingLineInput {
  /** Quantity (max 3 decimals). */
  quantity: number | string;
  /** Unit price, in cents. */
  unitPriceCents: number;
  /** Line discount in basis points (1000 ⇒ 10 %). */
  discountBp?: number;
}

/** Computed line: net amounts after the line discount **and** the share of the global discount. */
export interface PricingLineResult {
  quantity: number;
  unitPriceCents: number;
  discountBp: number;
  /** Quantity × unit price, before any discount. */
  grossCents: number;
  /** Line discount, in cents. */
  lineDiscountCents: number;
  /** Share of the document's global discount, in cents. */
  globalDiscountShareCents: number;
  /** Line total, net of all discounts. */
  totalCents: number;
}

export interface PricingDocumentResult {
  lines: PricingLineResult[];
  /** Sum of the bases before discount. */
  grossCents: number;
  /** Line discounts + global discount. */
  totalDiscountCents: number;
  totalCents: number;
}

export interface PricingDocumentOptions {
  /** Global discount in basis points, applied after the line discounts. */
  globalDiscountBp?: number;
  /** Global discount as an absolute value (cents). Can be combined with `globalDiscountBp`. */
  globalDiscountCents?: number;
}

function clampBp(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.min(10_000, Math.trunc(value as number)));
}

/**
 * Computes the totals of a document.
 *
 * The global discount is spread pro rata then **adjusted on the last discountable
 * line**: otherwise Σ(line totals) could differ from the document total by a few cents and
 * unbalance the accounting entry ([BR-7]).
 */
export function computeDocumentTotals(
  inputs: PricingLineInput[],
  options: PricingDocumentOptions = {}
): PricingDocumentResult {
  const staged = inputs.map((line) => {
    const quantity = normalizeQuantity(line.quantity);
    const unitPriceCents = Math.trunc(line.unitPriceCents || 0);
    const discountBp = clampBp(line.discountBp);
    const grossCents = roundHalfUp(quantity * unitPriceCents);
    const afterLineDiscountCents = applyDiscount(grossCents, discountBp);
    return {
      quantity,
      unitPriceCents,
      discountBp,
      grossCents,
      lineDiscountCents: grossCents - afterLineDiscountCents,
      afterLineDiscountCents,
    };
  });

  const subtotalCents = staged.reduce((sum, l) => sum + l.afterLineDiscountCents, 0);

  // Global discount: relative part + absolute part, capped at the subtotal.
  const relativeGlobal = applyRate(subtotalCents, clampBp(options.globalDiscountBp));
  const absoluteGlobal = Math.max(0, Math.trunc(options.globalDiscountCents || 0));
  const globalDiscountCents = Math.min(subtotalCents, relativeGlobal + absoluteGlobal);

  // Pro rata distribution, remainder on the last non-zero line.
  const shares = staged.map((l) =>
    subtotalCents > 0
      ? roundHalfUp((globalDiscountCents * l.afterLineDiscountCents) / subtotalCents)
      : 0
  );
  const distributed = shares.reduce((sum, s) => sum + s, 0);
  const remainder = globalDiscountCents - distributed;
  if (remainder !== 0) {
    const lastIndex = staged.reduce(
      (found, l, index) => (l.afterLineDiscountCents > 0 ? index : found),
      -1
    );
    if (lastIndex >= 0) shares[lastIndex] += remainder;
  }

  const lines: PricingLineResult[] = staged.map((l, index) => {
    const globalShare = shares[index] ?? 0;
    return {
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountBp: l.discountBp,
      grossCents: l.grossCents,
      lineDiscountCents: l.lineDiscountCents,
      globalDiscountShareCents: globalShare,
      totalCents: l.afterLineDiscountCents - globalShare,
    };
  });

  return {
    lines,
    grossCents: staged.reduce((sum, l) => sum + l.grossCents, 0),
    totalDiscountCents:
      staged.reduce((sum, l) => sum + l.lineDiscountCents, 0) + globalDiscountCents,
    totalCents: lines.reduce((sum, l) => sum + l.totalCents, 0),
  };
}

/** Amount still due on an invoice (never negative). */
export function remainingToPayCents(totalCents: number, paidCents: number): number {
  return Math.max(0, totalCents - paidCents);
}

/**
 * What the customer still owes on an invoice: total − paid − returned (credit notes).
 * Never below zero: a customer paid back for a return owes nothing.
 */
export function invoiceAmountDueCents(invoice: {
  totalCents: number;
  paidAmountCents: number;
  creditedAmountCents?: number | null;
}): number {
  return Math.max(
    0,
    invoice.totalCents - invoice.paidAmountCents - (invoice.creditedAmountCents ?? 0)
  );
}

/**
 * Status of a validated invoice from its payments and returns: everything returned
 * cancels it; otherwise the returns reduce what has to be paid.
 */
export function deriveSettlementStatus(invoice: {
  totalCents: number;
  paidAmountCents: number;
  creditedAmountCents?: number | null;
}): "VALIDATED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED" {
  const credited = invoice.creditedAmountCents ?? 0;
  if (invoice.totalCents > 0 && credited >= invoice.totalCents) return "CANCELLED";
  return derivePaymentStatus(invoice.totalCents - credited, invoice.paidAmountCents);
}

/** Payment status derived from the amounts — never entered by hand. */
export function derivePaymentStatus(
  totalCents: number,
  paidCents: number
): "VALIDATED" | "PARTIALLY_PAID" | "PAID" {
  // Nothing to pay (free item, everything returned): nothing is waiting for money.
  if (totalCents <= 0) return "PAID";
  if (paidCents <= 0) return "VALIDATED";
  if (paidCents >= totalCents) return "PAID";
  return "PARTIALLY_PAID";
}
