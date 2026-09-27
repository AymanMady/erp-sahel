/** Automatic entries: balance and account direction ([BR-7], [FR-CPT-1]). */

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

describe("sales invoice entry", () => {
  const posting = buildSalesInvoicePosting({
    totalCents: 100_000,
    partyId: "party-1",
    label: "Invoice FAC-2026-0001",
  });

  it("is balanced", () => {
    const totals = assertBalanced(posting);
    expect(totals.totalDebitCents).toBe(100_000);
    expect(totals.totalCreditCents).toBe(100_000);
  });

  it("debits the customer and credits sales", () => {
    expect(posting).toHaveLength(2);
    expect(posting[0]).toMatchObject({ mappingKey: "CUSTOMER_RECEIVABLE", debitCents: 100_000 });
    expect(posting[1]).toMatchObject({ mappingKey: "SALES_REVENUE", creditCents: 100_000 });
  });
});

describe("credit note", () => {
  it("is the exact mirror of the invoice", () => {
    const input = {
      totalCents: 100_000,
      partyId: "party-1",
      label: "Credit note",
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

describe("supplier invoice entry", () => {
  it("debits purchases and credits the supplier", () => {
    const posting = buildSupplierInvoicePosting({
      totalCents: 50_000,
      partyId: "supplier-1",
      label: "Supplier invoice",
    });
    expect(() => assertBalanced(posting)).not.toThrow();
    expect(posting.find((line) => line.mappingKey === "PURCHASES")?.debitCents).toBe(50_000);
    expect(posting.find((line) => line.mappingKey === "SUPPLIER_PAYABLE")?.creditCents).toBe(
      50_000
    );
  });
});

describe("payment entry", () => {
  it("debits treasury for a receipt", () => {
    const posting = buildPaymentPosting({
      direction: "IN",
      amountCents: 58_000,
      method: "CASH",
      partyId: "party-1",
      label: "Payment",
    });
    expect(posting[0]).toMatchObject({ mappingKey: "CASH", debitCents: 58_000 });
    expect(posting[1]).toMatchObject({ mappingKey: "CUSTOMER_RECEIVABLE", creditCents: 58_000 });
    expect(() => assertBalanced(posting)).not.toThrow();
  });

  it("reverses the direction for a supplier disbursement", () => {
    const posting = buildPaymentPosting({
      direction: "OUT",
      amountCents: 58_000,
      method: "BANK_TRANSFER",
      partyId: "supplier-1",
      label: "Payment",
    });
    expect(posting.find((line) => line.mappingKey === "BANK")?.creditCents).toBe(58_000);
    expect(posting.find((line) => line.mappingKey === "SUPPLIER_PAYABLE")?.debitCents).toBe(58_000);
  });

  it("picks the treasury account from the payment method", () => {
    expect(treasuryMappingKey("CASH")).toBe("CASH");
    expect(treasuryMappingKey("MOBILE_MONEY")).toBe("MOBILE_MONEY");
    expect(treasuryMappingKey("CHECK")).toBe("BANK");
  });
});

describe("balance guard", () => {
  it("rejects an unbalanced entry", () => {
    expect(() =>
      assertBalanced([
        { mappingKey: "CASH", debitCents: 100, creditCents: 0, label: "x" },
        { mappingKey: "SALES_REVENUE", debitCents: 0, creditCents: 99, label: "y" },
      ])
    ).toThrow(UnbalancedEntryError);
  });
});

describe("account direction", () => {
  it("follows the account type", () => {
    expect(naturalBalance("ASSET")).toBe("DEBIT");
    expect(naturalBalance("REVENUE")).toBe("CREDIT");
    expect(accountBalanceCents("ASSET", 1000, 300)).toBe(700);
    expect(accountBalanceCents("REVENUE", 300, 1000)).toBe(700);
  });
});

describe("charts of accounts", () => {
  it("provides OHADA by default and PCG as an alternative", () => {
    expect(chartTemplateFor("OHADA").standard).toBe("OHADA");
    expect(chartTemplateFor("PCG").standard).toBe("PCG");
    // A standard without a template falls back to OHADA instead of failing.
    expect(chartTemplateFor("IFRS").standard).toBe("OHADA");
  });

  it("maps an account to every essential posting key", () => {
    const keys = chartTemplateFor("OHADA")
      .accounts.map((account) => account.mappingKey)
      .filter(Boolean);
    for (const required of [
      "SALES_REVENUE",
      "CUSTOMER_RECEIVABLE",
      "SUPPLIER_PAYABLE",
      "CASH",
      "BANK",
    ]) {
      expect(keys).toContain(required);
    }
  });
});
