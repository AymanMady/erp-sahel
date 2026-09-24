/**
 * Totals computation — the core of invoicing ([FR-VNT-4]).
 *
 * These tests mainly check accuracy to the cent: that is where the discrepancies
 * that later unbalance accounting entries hide.
 */

import { describe, expect, it } from "vitest";

import { applyDiscount, applyRate, formatMoney, parseAmountToCents, roundHalfUp } from "../money";
import { computeDocumentTotals, derivePaymentStatus, remainingToPayCents } from "../pricing";

describe("money arithmetic", () => {
  it("rounds symmetrically around zero", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
  });

  it("applies a basis-point rate without floating-point drift", () => {
    expect(applyRate(10_000, 1600)).toBe(1600);
    expect(applyRate(333, 1600)).toBe(53);
    expect(applyDiscount(10_000, 1000)).toBe(9000);
  });

  it("parses a French-formatted user input", () => {
    expect(parseAmountToCents("1 250,50")).toBe(125_050);
    expect(parseAmountToCents("1250.5")).toBe(125_050);
    expect(parseAmountToCents("")).toBe(0);
    expect(parseAmountToCents("1,250.50")).toBe(125_050);
    expect(parseAmountToCents("1.250,50")).toBe(125_050);
    expect(parseAmountToCents("1,250,000")).toBe(125_000_000);
    expect(parseAmountToCents("12,5")).toBe(1_250);
    expect(parseAmountToCents("1٬250٫50")).toBe(125_050);
  });

  it("formats with the currency and falls back cleanly on an unknown code", () => {
    expect(formatMoney(125_050, "MRU")).toContain("MRU");
    expect(formatMoney(125_050, "MRU", "fr-FR")).toBe("1\u202f250,50 MRU");
    expect(formatMoney(125_050, "MRU", "en-GB")).toBe("1,250.50 MRU");
    expect(formatMoney(125_050, "ZZZ")).toContain("ZZZ");
  });
});

describe("document totals", () => {
  it("computes excl. tax, VAT and incl. tax line by line", () => {
    const result = computeDocumentTotals([
      { quantity: 2, unitPriceCents: 52_000, vatRateBp: 1600 },
      { quantity: 1, unitPriceCents: 16_500, vatRateBp: 1600 },
    ]);

    expect(result.totalHtCents).toBe(120_500);
    expect(result.totalVatCents).toBe(19_280);
    expect(result.totalTtcCents).toBe(139_780);
  });

  it("applies the line discount before VAT", () => {
    const result = computeDocumentTotals([
      { quantity: 1, unitPriceCents: 100_000, discountBp: 1000, vatRateBp: 1600 },
    ]);
    expect(result.totalHtCents).toBe(90_000);
    expect(result.totalVatCents).toBe(14_400);
  });

  /**
   * Critical case: a global discount spread pro rata produces rounding.
   * The sum of the lines must stay **exactly** equal to the document total, otherwise
   * the accounting entry would be off by one cent.
   */
  it("spreads the global discount without losing a cent", () => {
    const result = computeDocumentTotals(
      [
        { quantity: 1, unitPriceCents: 3_333, vatRateBp: 1600 },
        { quantity: 1, unitPriceCents: 3_333, vatRateBp: 1600 },
        { quantity: 1, unitPriceCents: 3_334, vatRateBp: 1600 },
      ],
      { globalDiscountBp: 777 }
    );

    const sumOfLines = result.lines.reduce((sum, line) => sum + line.totalHtCents, 0);
    expect(sumOfLines).toBe(result.totalHtCents);

    const expectedDiscount = applyRate(10_000, 777);
    expect(result.totalHtCents).toBe(10_000 - expectedDiscount);
  });

  it("zeroes VAT when the company is not subject to VAT", () => {
    const result = computeDocumentTotals(
      [{ quantity: 3, unitPriceCents: 10_000, vatRateBp: 1600 }],
      {
        vatEnabled: false,
      }
    );
    expect(result.totalVatCents).toBe(0);
    expect(result.totalTtcCents).toBe(result.totalHtCents);
  });

  it("breaks VAT down by rate", () => {
    const result = computeDocumentTotals([
      { quantity: 1, unitPriceCents: 10_000, vatRateBp: 1600 },
      { quantity: 1, unitPriceCents: 10_000, vatRateBp: 0 },
      { quantity: 1, unitPriceCents: 20_000, vatRateBp: 1600 },
    ]);
    expect(result.vatBreakdown).toEqual([
      { vatRateBp: 0, baseCents: 10_000, vatCents: 0 },
      { vatRateBp: 1600, baseCents: 30_000, vatCents: 4_800 },
    ]);
  });

  it("caps the global discount at the subtotal", () => {
    const result = computeDocumentTotals([{ quantity: 1, unitPriceCents: 5_000 }], {
      globalDiscountCents: 999_999,
    });
    expect(result.totalHtCents).toBe(0);
  });
});

describe("payment status", () => {
  it("is derived from the amounts, never entered", () => {
    expect(derivePaymentStatus(10_000, 0)).toBe("VALIDATED");
    expect(derivePaymentStatus(10_000, 4_000)).toBe("PARTIALLY_PAID");
    expect(derivePaymentStatus(10_000, 10_000)).toBe("PAID");
  });

  it("never returns a negative amount due", () => {
    expect(remainingToPayCents(10_000, 12_000)).toBe(0);
  });
});
