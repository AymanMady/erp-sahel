/**
 * Calcul des totaux — cœur de la facturation ([FR-VNT-4]).
 *
 * Ces tests vérifient surtout l'exactitude au centime : c'est là que se logent les
 * écarts qui déséquilibrent ensuite les écritures comptables.
 */

import { describe, expect, it } from "vitest";

import { applyDiscount, applyRate, formatMoney, parseAmountToCents, roundHalfUp } from "../money";
import { computeDocumentTotals, derivePaymentStatus, remainingToPayCents } from "../pricing";

describe("arithmétique monétaire", () => {
  it("arrondit symétriquement autour de zéro", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
  });

  it("applique un taux en points de base sans dérive flottante", () => {
    expect(applyRate(10_000, 1600)).toBe(1600);
    expect(applyRate(333, 1600)).toBe(53);
    expect(applyDiscount(10_000, 1000)).toBe(9000);
  });

  it("interprète une saisie utilisateur française", () => {
    expect(parseAmountToCents("1 250,50")).toBe(125_050);
    expect(parseAmountToCents("1250.5")).toBe(125_050);
    expect(parseAmountToCents("")).toBe(0);
  });

  it("formate avec la devise et retombe proprement sur un code inconnu", () => {
    expect(formatMoney(125_050, "MRU")).toContain("MRU");
    expect(formatMoney(125_050, "ZZZ")).toContain("ZZZ");
  });
});

describe("totaux de document", () => {
  it("calcule HT, TVA et TTC ligne par ligne", () => {
    const result = computeDocumentTotals([
      { quantity: 2, unitPriceCents: 52_000, vatRateBp: 1600 },
      { quantity: 1, unitPriceCents: 16_500, vatRateBp: 1600 },
    ]);

    expect(result.totalHtCents).toBe(120_500);
    expect(result.totalVatCents).toBe(19_280);
    expect(result.totalTtcCents).toBe(139_780);
  });

  it("applique la remise de ligne avant la TVA", () => {
    const result = computeDocumentTotals([
      { quantity: 1, unitPriceCents: 100_000, discountBp: 1000, vatRateBp: 1600 },
    ]);
    expect(result.totalHtCents).toBe(90_000);
    expect(result.totalVatCents).toBe(14_400);
  });

  /**
   * Cas critique : une remise globale répartie au prorata produit des arrondis.
   * La somme des lignes doit rester **exactement** égale au total du document, sans
   * quoi l'écriture comptable serait déséquilibrée d'un centime.
   */
  it("répartit la remise globale sans perdre de centime", () => {
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

  it("annule la TVA quand la société n'est pas assujettie", () => {
    const result = computeDocumentTotals(
      [{ quantity: 3, unitPriceCents: 10_000, vatRateBp: 1600 }],
      {
        vatEnabled: false,
      }
    );
    expect(result.totalVatCents).toBe(0);
    expect(result.totalTtcCents).toBe(result.totalHtCents);
  });

  it("ventile la TVA par taux", () => {
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

  it("plafonne la remise globale au sous-total", () => {
    const result = computeDocumentTotals([{ quantity: 1, unitPriceCents: 5_000 }], {
      globalDiscountCents: 999_999,
    });
    expect(result.totalHtCents).toBe(0);
  });
});

describe("statut de règlement", () => {
  it("se déduit des montants, jamais d'une saisie", () => {
    expect(derivePaymentStatus(10_000, 0)).toBe("VALIDATED");
    expect(derivePaymentStatus(10_000, 4_000)).toBe("PARTIALLY_PAID");
    expect(derivePaymentStatus(10_000, 10_000)).toBe("PAID");
  });

  it("ne renvoie jamais un reste à payer négatif", () => {
    expect(remainingToPayCents(10_000, 12_000)).toBe(0);
  });
});
