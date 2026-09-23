/** Écritures automatiques : équilibre et sens des comptes ([BR-7], [FR-CPT-1]). */

import { describe, expect, it } from "vitest";

import {
  UnbalancedEntryError,
  accountBalanceCents,
  assertBalanced,
  buildCreditNotePosting,
  buildPaymentPosting,
  buildSalesInvoicePosting,
  buildSupplierInvoicePosting,
  chartTemplateFor,
  naturalBalance,
  treasuryMappingKey,
} from "../accounting-rules";

describe("écriture de facture de vente", () => {
  const posting = buildSalesInvoicePosting({
    totalHtCents: 100_000,
    totalVatCents: 16_000,
    totalTtcCents: 116_000,
    partyId: "party-1",
    label: "Facture FAC-2026-0001",
  });

  it("est équilibrée", () => {
    const totals = assertBalanced(posting);
    expect(totals.totalDebitCents).toBe(116_000);
    expect(totals.totalCreditCents).toBe(116_000);
  });

  it("débite le client et crédite ventes puis TVA", () => {
    expect(posting[0]).toMatchObject({ mappingKey: "CUSTOMER_RECEIVABLE", debitCents: 116_000 });
    expect(posting[1]).toMatchObject({ mappingKey: "SALES_REVENUE", creditCents: 100_000 });
    expect(posting[2]).toMatchObject({ mappingKey: "VAT_COLLECTED", creditCents: 16_000 });
  });

  it("omet la ligne de TVA quand la société n'est pas assujettie", () => {
    const withoutVat = buildSalesInvoicePosting({
      totalHtCents: 100_000,
      totalVatCents: 0,
      totalTtcCents: 100_000,
      partyId: "party-1",
      label: "Facture",
    });
    expect(withoutVat).toHaveLength(2);
    expect(() => assertBalanced(withoutVat)).not.toThrow();
  });
});

describe("avoir", () => {
  it("est le miroir exact de la facture", () => {
    const input = {
      totalHtCents: 100_000,
      totalVatCents: 16_000,
      totalTtcCents: 116_000,
      partyId: "party-1",
      label: "Avoir",
    };
    const invoice = buildSalesInvoicePosting(input);
    const credit = buildCreditNotePosting(input);

    credit.forEach((line, index) => {
      expect(line.debitCents).toBe(invoice[index].creditCents);
      expect(line.creditCents).toBe(invoice[index].debitCents);
    });
    expect(() => assertBalanced(credit)).not.toThrow();
  });
});

describe("écriture de facture fournisseur", () => {
  it("débite achats et TVA déductible, crédite le fournisseur", () => {
    const posting = buildSupplierInvoicePosting({
      totalHtCents: 50_000,
      totalVatCents: 8_000,
      totalTtcCents: 58_000,
      partyId: "supplier-1",
      label: "Facture fournisseur",
    });
    expect(() => assertBalanced(posting)).not.toThrow();
    expect(posting.find((line) => line.mappingKey === "SUPPLIER_PAYABLE")?.creditCents).toBe(
      58_000
    );
    expect(posting.find((line) => line.mappingKey === "VAT_DEDUCTIBLE")?.debitCents).toBe(8_000);
  });
});

describe("écriture de règlement", () => {
  it("débite la trésorerie pour un encaissement", () => {
    const posting = buildPaymentPosting({
      direction: "IN",
      amountCents: 58_000,
      method: "CASH",
      partyId: "party-1",
      label: "Règlement",
    });
    expect(posting[0]).toMatchObject({ mappingKey: "CASH", debitCents: 58_000 });
    expect(posting[1]).toMatchObject({ mappingKey: "CUSTOMER_RECEIVABLE", creditCents: 58_000 });
    expect(() => assertBalanced(posting)).not.toThrow();
  });

  it("inverse le sens pour un décaissement fournisseur", () => {
    const posting = buildPaymentPosting({
      direction: "OUT",
      amountCents: 58_000,
      method: "BANK_TRANSFER",
      partyId: "supplier-1",
      label: "Règlement",
    });
    expect(posting.find((line) => line.mappingKey === "BANK")?.creditCents).toBe(58_000);
    expect(posting.find((line) => line.mappingKey === "SUPPLIER_PAYABLE")?.debitCents).toBe(58_000);
  });

  it("choisit le compte de trésorerie selon le mode de règlement", () => {
    expect(treasuryMappingKey("CASH")).toBe("CASH");
    expect(treasuryMappingKey("MOBILE_MONEY")).toBe("MOBILE_MONEY");
    expect(treasuryMappingKey("CHECK")).toBe("BANK");
  });
});

describe("garde-fou d'équilibre", () => {
  it("refuse une écriture déséquilibrée", () => {
    expect(() =>
      assertBalanced([
        { mappingKey: "CASH", debitCents: 100, creditCents: 0, label: "x" },
        { mappingKey: "SALES_REVENUE", debitCents: 0, creditCents: 99, label: "y" },
      ])
    ).toThrow(UnbalancedEntryError);
  });
});

describe("sens des comptes", () => {
  it("suit la nature du compte", () => {
    expect(naturalBalance("ASSET")).toBe("DEBIT");
    expect(naturalBalance("REVENUE")).toBe("CREDIT");
    expect(accountBalanceCents("ASSET", 1000, 300)).toBe(700);
    expect(accountBalanceCents("REVENUE", 300, 1000)).toBe(700);
  });
});

describe("plans comptables", () => {
  it("fournit OHADA par défaut et PCG en alternative", () => {
    expect(chartTemplateFor("OHADA").standard).toBe("OHADA");
    expect(chartTemplateFor("PCG").standard).toBe("PCG");
    // Un référentiel non fourni retombe sur OHADA plutôt que d'échouer.
    expect(chartTemplateFor("IFRS").standard).toBe("OHADA");
  });

  it("associe un compte à chaque clé d'automatisme essentielle", () => {
    const keys = chartTemplateFor("OHADA")
      .accounts.map((account) => account.mappingKey)
      .filter(Boolean);
    for (const required of [
      "SALES_REVENUE",
      "VAT_COLLECTED",
      "CUSTOMER_RECEIVABLE",
      "SUPPLIER_PAYABLE",
      "CASH",
      "BANK",
    ]) {
      expect(keys).toContain(required);
    }
  });
});
