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

  it("writes the ouguiya in full and hides decimals on round amounts", () => {
    expect(formatMoney(125_050, "fr-FR")).toBe("1\u202f250,50 ouguiyas");
    expect(formatMoney(125_000, "fr-FR")).toBe("1\u202f250 ouguiyas");
    expect(formatMoney(100, "fr-FR")).toBe("1 ouguiya");
    expect(formatMoney(125_050, "en-GB")).toBe("1,250.50 ouguiyas");
    expect(formatMoney(125_000, "ar-u-nu-latn")).toContain("أوقية");
    expect(formatMoney(125_000, "fr-FR", { withSymbol: false })).toBe("1\u202f250");
  });
});

describe("document totals", () => {
  it("computes the total line by line", () => {
    const result = computeDocumentTotals([
      { quantity: 2, unitPriceCents: 52_000 },
      { quantity: 1, unitPriceCents: 16_500 },
    ]);

    expect(result.lines.map((line) => line.totalCents)).toEqual([104_000, 16_500]);
    expect(result.totalCents).toBe(120_500);
  });

  it("applies the line discount", () => {
    const result = computeDocumentTotals([
      { quantity: 1, unitPriceCents: 100_000, discountBp: 1000 },
    ]);
    expect(result.totalCents).toBe(90_000);
    expect(result.totalDiscountCents).toBe(10_000);
  });

  /**
   * Critical case: a global discount spread pro rata produces rounding.
   * The sum of the lines must stay **exactly** equal to the document total, otherwise
   * the accounting entry would be off by one cent.
   */
  it("spreads the global discount without losing a cent", () => {
    const result = computeDocumentTotals(
      [
        { quantity: 1, unitPriceCents: 3_333 },
        { quantity: 1, unitPriceCents: 3_333 },
        { quantity: 1, unitPriceCents: 3_334 },
      ],
      { globalDiscountBp: 777 }
    );

    const sumOfLines = result.lines.reduce((sum, line) => sum + line.totalCents, 0);
    expect(sumOfLines).toBe(result.totalCents);

    const expectedDiscount = applyRate(10_000, 777);
    expect(result.totalCents).toBe(10_000 - expectedDiscount);
  });

  it("caps the global discount at the subtotal", () => {
    const result = computeDocumentTotals([{ quantity: 1, unitPriceCents: 5_000 }], {
      globalDiscountCents: 999_999,
    });
    expect(result.totalCents).toBe(0);
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
