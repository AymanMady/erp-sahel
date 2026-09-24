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
 *  4. line VAT         = net base × line rate   (rounded to the cent, per line)
 *  5. incl. tax (TTC)  = excl. tax (HT) + VAT
 */

import { applyDiscount, applyRate, normalizeQuantity, roundHalfUp } from "./money";

/** A line as entered in the UI or received by the API. */
export interface PricingLineInput {
  /** Quantity (max 3 decimals). */
  quantity: number | string;
  /** Unit price excluding tax, in cents. */
  unitPriceCents: number;
  /** Line discount in basis points (1000 ⇒ 10 %). */
  discountBp?: number;
  /** VAT rate in basis points (1600 ⇒ 16 %). */
  vatRateBp?: number;
}

/** Computed line: net amounts after the line discount **and** the share of the global discount. */
export interface PricingLineResult {
  quantity: number;
  unitPriceCents: number;
  discountBp: number;
  vatRateBp: number;
  /** Quantity × unit price, before any discount. */
  grossCents: number;
  /** Line discount, in cents. */
  lineDiscountCents: number;
  /** Share of the document's global discount, in cents. */
  globalDiscountShareCents: number;
  /** Base excluding tax, net of all discounts. */
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
}

export interface PricingDocumentResult {
  lines: PricingLineResult[];
  /** Sum of the bases before discount. */
  grossCents: number;
  /** Line discounts + global discount. */
  totalDiscountCents: number;
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  /** VAT breakdown by rate — needed for accounting entries and the invoice. */
  vatBreakdown: { vatRateBp: number; baseCents: number; vatCents: number }[];
}

export interface PricingDocumentOptions {
  /** Global discount in basis points, applied after the line discounts. */
  globalDiscountBp?: number;
  /** Global discount as an absolute value (cents). Can be combined with `globalDiscountBp`. */
  globalDiscountCents?: number;
  /** If `false`, lines are VAT-exempt (company not subject to VAT). */
  vatEnabled?: boolean;
}

function clampBp(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.min(10_000, Math.trunc(value as number)));
}

/**
 * Computes the totals of a document.
 *
 * The global discount is spread pro rata then **adjusted on the last discountable
 * line**: otherwise Σ(line HT) could differ from the document HT by a few cents and
 * unbalance the accounting entry ([BR-7]).
 */
export function computeDocumentTotals(
  inputs: PricingLineInput[],
  options: PricingDocumentOptions = {}
): PricingDocumentResult {
  const vatEnabled = options.vatEnabled ?? true;

  const staged = inputs.map((line) => {
    const quantity = normalizeQuantity(line.quantity);
    const unitPriceCents = Math.trunc(line.unitPriceCents || 0);
    const discountBp = clampBp(line.discountBp);
    const vatRateBp = vatEnabled ? clampBp(line.vatRateBp) : 0;
    const grossCents = roundHalfUp(quantity * unitPriceCents);
    const afterLineDiscountCents = applyDiscount(grossCents, discountBp);
    return {
      quantity,
      unitPriceCents,
      discountBp,
      vatRateBp,
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
    const totalHtCents = l.afterLineDiscountCents - globalShare;
    const totalVatCents = applyRate(totalHtCents, l.vatRateBp);
    return {
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountBp: l.discountBp,
      vatRateBp: l.vatRateBp,
      grossCents: l.grossCents,
      lineDiscountCents: l.lineDiscountCents,
      globalDiscountShareCents: globalShare,
      totalHtCents,
      totalVatCents,
      totalTtcCents: totalHtCents + totalVatCents,
    };
  });

  const byRate = new Map<number, { baseCents: number; vatCents: number }>();
  for (const line of lines) {
    const bucket = byRate.get(line.vatRateBp) ?? { baseCents: 0, vatCents: 0 };
    bucket.baseCents += line.totalHtCents;
    bucket.vatCents += line.totalVatCents;
    byRate.set(line.vatRateBp, bucket);
  }

  return {
    lines,
    grossCents: staged.reduce((sum, l) => sum + l.grossCents, 0),
    totalDiscountCents:
      staged.reduce((sum, l) => sum + l.lineDiscountCents, 0) + globalDiscountCents,
    totalHtCents: lines.reduce((sum, l) => sum + l.totalHtCents, 0),
    totalVatCents: lines.reduce((sum, l) => sum + l.totalVatCents, 0),
    totalTtcCents: lines.reduce((sum, l) => sum + l.totalTtcCents, 0),
    vatBreakdown: [...byRate.entries()]
      .map(([vatRateBp, bucket]) => ({ vatRateBp, ...bucket }))
      .sort((a, b) => a.vatRateBp - b.vatRateBp),
  };
}

/** Amount still due on an invoice (never negative). */
export function remainingToPayCents(totalTtcCents: number, paidCents: number): number {
  return Math.max(0, totalTtcCents - paidCents);
}

/** Payment status derived from the amounts — never entered by hand. */
export function derivePaymentStatus(
  totalTtcCents: number,
  paidCents: number
): "VALIDATED" | "PARTIALLY_PAID" | "PAID" {
  if (paidCents <= 0) return "VALIDATED";
  if (paidCents >= totalTtcCents) return "PAID";
  return "PARTIALLY_PAID";
}
