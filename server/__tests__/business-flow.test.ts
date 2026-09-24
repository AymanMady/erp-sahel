/**
 * End-to-end business chain (§16.2 and §17 of the specification):
 *
 *   product → invoice → stock decrement → payment → journal entry
 *   → general ledger → trial balance
 *
 * Each step checks its own invariant ([BR-6], [BR-7], [BR-10]). Failures are asserted
 * on error `code`s, never on message text (messages are translated).
 */

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { computeDocumentTotals } from "@shared/pricing";
import { todayInput } from "@shared/format";
import { journalEntries, journalLines, stockItems, stockMovements } from "@shared/schema";
import { closeDatabase, db } from "../db";
import { accountingRepository } from "../domains/accounting/repository";
import { invoicingApplication } from "../domains/invoicing/application";
import { paymentsApplication } from "../domains/payments/application";
import { partiesApplication } from "../domains/parties/application";
import { posApplication } from "../domains/pos/application";
import { purchasingApplication } from "../domains/purchasing/application";
import { salesApplication } from "../domains/sales/application";
import { db as database } from "../db";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

let context: TestContext;
let productId: string;
let customerId: string;

beforeAll(async () => {
  context = await createTestCompany("flow");
  const product = await createStockedProduct(context, { salePriceCents: 10_000, quantity: 50 });
  productId = product.id;

  const customer = await partiesApplication.create(
    context.company.id,
    { name: "Integration customer", partyType: "CUSTOMER" },
    database
  );
  customerId = customer.id;
});

afterAll(async () => {
  await dropTestCompany(context);
  await closeDatabase();
});

async function stockOf(): Promise<number> {
  const [row] = await db
    .select()
    .from(stockItems)
    .where(and(eq(stockItems.companyId, context.company.id), eq(stockItems.productId, productId)));
  return Number(row.quantity);
}

describe("sales invoice", () => {
  it("leaves stock untouched while it is a draft", async () => {
    const before = await stockOf();
    const invoice = await invoicingApplication.create(
      context.company,
      {
        partyId: customerId,
        lines: [{ productId, quantity: 5, description: "Article" }],
        validate: false,
      },
      context.userId
    );

    expect(invoice.status).toBe("DRAFT");
    expect(invoice.isLocked).toBe(false);
    expect(await stockOf()).toBe(before);

    // A draft does not consume a legal number.
    expect(invoice.number.startsWith("BR-")).toBe(true);
  });

  it("decrements stock and posts the entry on validation", async () => {
    const before = await stockOf();
    const draft = await invoicingApplication.create(
      context.company,
      {
        partyId: customerId,
        lines: [{ productId, quantity: 4, description: "Article" }],
      },
      context.userId
    );

    const validated = await invoicingApplication.validate(
      context.company,
      draft.id,
      context.userId
    );

    expect(validated.status).toBe("VALIDATED");
    expect(validated.isLocked).toBe(true);
    expect(validated.number).toMatch(/^FAC-\d{4}-\d{4}$/);
    expect(await stockOf()).toBe(before - 4);

    // An outgoing movement is recorded, linked to the invoice.
    const movements = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.companyId, context.company.id),
          eq(stockMovements.originId, validated.id)
        )
      );
    expect(movements).toHaveLength(1);
    expect(movements[0].direction).toBe("OUT");
    expect(Number(movements[0].quantity)).toBe(4);

    // The sales entry is balanced.
    const entry = await accountingRepository.findEntryByOrigin(
      context.company.id,
      "sales_invoice",
      validated.id
    );
    expect(entry).not.toBeNull();
    expect(entry?.totalDebitCents).toBe(entry?.totalCreditCents);
    expect(entry?.totalDebitCents).toBe(validated.totalTtcCents);
  });

  it("rejects any change after validation", async () => {
    const draft = await invoicingApplication.create(
      context.company,
      { partyId: customerId, lines: [{ productId, quantity: 1, description: "Article" }] },
      context.userId
    );
    const validated = await invoicingApplication.validate(
      context.company,
      draft.id,
      context.userId
    );

    await expect(
      invoicingApplication.update(context.company, validated.id, { notes: "modification" })
    ).rejects.toMatchObject({ code: "INVOICE_LOCKED" });
  });

  it("refuses to sell more than the available stock", async () => {
    await expect(
      invoicingApplication.create(
        context.company,
        {
          partyId: customerId,
          lines: [{ productId, quantity: 99_999, description: "Article" }],
          validate: true,
        },
        context.userId
      )
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });
});

describe("payment", () => {
  it("settles the invoice, credits cash and posts the entry", async () => {
    const draft = await invoicingApplication.create(
      context.company,
      { partyId: customerId, lines: [{ productId, quantity: 2, description: "Article" }] },
      context.userId
    );
    const invoice = await invoicingApplication.validate(context.company, draft.id, context.userId);

    const payment = await paymentsApplication.create(
      context.company,
      {
        partyId: customerId,
        invoiceId: invoice.id,
        amountCents: invoice.totalTtcCents,
        paymentMethod: "CASH",
      },
      context.userId
    );

    const refreshed = await invoicingApplication.get(context.company.id, invoice.id);
    expect(refreshed.status).toBe("PAID");
    expect(refreshed.paidAmountCents).toBe(invoice.totalTtcCents);

    const entry = await accountingRepository.findEntryByOrigin(
      context.company.id,
      "payment",
      payment.id
    );
    expect(entry?.totalDebitCents).toBe(invoice.totalTtcCents);
  });

  it("rejects a payment greater than the amount due", async () => {
    const draft = await invoicingApplication.create(
      context.company,
      { partyId: customerId, lines: [{ productId, quantity: 1, description: "Article" }] },
      context.userId
    );
    const invoice = await invoicingApplication.validate(context.company, draft.id, context.userId);

    await expect(
      paymentsApplication.create(
        context.company,
        {
          partyId: customerId,
          invoiceId: invoice.id,
          amountCents: invoice.totalTtcCents + 1,
          paymentMethod: "CASH",
        },
        context.userId
      )
    ).rejects.toMatchObject({ code: "OVERPAYMENT" });
  });

  it("marks the invoice partially paid on a deposit", async () => {
    const draft = await invoicingApplication.create(
      context.company,
      { partyId: customerId, lines: [{ productId, quantity: 2, description: "Article" }] },
      context.userId
    );
    const invoice = await invoicingApplication.validate(context.company, draft.id, context.userId);

    await paymentsApplication.create(
      context.company,
      {
        partyId: customerId,
        invoiceId: invoice.id,
        amountCents: Math.floor(invoice.totalTtcCents / 2),
        paymentMethod: "CASH",
      },
      context.userId
    );

    const refreshed = await invoicingApplication.get(context.company.id, invoice.id);
    expect(refreshed.status).toBe("PARTIALLY_PAID");
  });
});

describe("credit note", () => {
  it("restocks and posts the reversing entry", async () => {
    const draft = await invoicingApplication.create(
      context.company,
      { partyId: customerId, lines: [{ productId, quantity: 3, description: "Article" }] },
      context.userId
    );
    const invoice = await invoicingApplication.validate(context.company, draft.id, context.userId);
    const afterInvoice = await stockOf();

    const creditNote = await invoicingApplication.createCreditNote(
      context.company,
      { invoiceId: invoice.id, reason: "Customer return", restock: true },
      context.userId
    );

    expect(creditNote?.number).toMatch(/^AV-\d{4}-\d{4}$/);
    expect(await stockOf()).toBe(afterInvoice + 3);

    const entry = await accountingRepository.findEntryByOrigin(
      context.company.id,
      "credit_note",
      creditNote!.id
    );
    expect(entry?.totalDebitCents).toBe(entry?.totalCreditCents);
    expect(entry?.totalDebitCents).toBe(invoice.totalTtcCents);
  });

  it("rejects a credit note on a draft", async () => {
    const draft = await invoicingApplication.create(
      context.company,
      { partyId: customerId, lines: [{ productId, quantity: 1, description: "Article" }] },
      context.userId
    );
    await expect(
      invoicingApplication.createCreditNote(
        context.company,
        { invoiceId: draft.id },
        context.userId
      )
    ).rejects.toMatchObject({ code: "INVOICE_NOT_VALIDATED" });
  });
});

describe("quote → order → invoice chain", () => {
  it("converts without losing any amount", async () => {
    const quote = await salesApplication.createQuote(
      context.company,
      {
        partyId: customerId,
        lines: [{ productId, quantity: 2, description: "Article" }],
      },
      context.userId
    );
    expect(quote.number).toMatch(/^DEV-\d{4}-\d{4}$/);

    const order = await salesApplication.convertQuoteToOrder(
      context.company,
      quote.id,
      context.userId
    );
    expect(order.totalTtcCents).toBe(quote.totalTtcCents);

    const invoice = await salesApplication.invoiceOrder(context.company, order.id, context.userId);
    expect(invoice.totalTtcCents).toBe(quote.totalTtcCents);
    // An invoice created from an order starts as a draft: it must be validated.
    expect(invoice.status).toBe("DRAFT");

    const refreshedQuote = await salesApplication.getQuote(context.company.id, quote.id);
    expect(refreshedQuote.status).toBe("CONVERTED");
  });

  it("refuses to convert the same quote twice", async () => {
    const quote = await salesApplication.createQuote(
      context.company,
      { partyId: customerId, lines: [{ productId, quantity: 1, description: "Article" }] },
      context.userId
    );
    await salesApplication.convertQuoteToOrder(context.company, quote.id, context.userId);
    await expect(
      salesApplication.convertQuoteToOrder(context.company, quote.id, context.userId)
    ).rejects.toMatchObject({ code: "QUOTE_ALREADY_CONVERTED" });
  });
});

describe("purchasing: order → receipt", () => {
  it("brings the goods into stock at the given cost", async () => {
    const supplier = await partiesApplication.create(
      context.company.id,
      { name: "Integration supplier", partyType: "SUPPLIER" },
      database
    );

    const order = await purchasingApplication.createOrder(
      context.company,
      {
        supplierId: supplier.id,
        lines: [{ productId, quantity: 10, unitPriceCents: 2_000, description: "Article" }],
      },
      context.userId
    );

    const before = await stockOf();
    await purchasingApplication.createReceipt(
      context.company,
      {
        purchaseOrderId: order.id,
        lines: [
          { purchaseOrderLineId: order.lines[0].id, productId, quantity: 10, unitCostCents: 2_000 },
        ],
      },
      context.userId
    );

    expect(await stockOf()).toBe(before + 10);

    const refreshed = await purchasingApplication.getOrder(context.company.id, order.id);
    expect(refreshed.status).toBe("RECEIVED");
  });
});

describe("point of sale", () => {
  it("collects a full ticket and updates the session", async () => {
    const session = await posApplication.openSession(context.company, context.userId, {
      registerId: context.registerId,
      openingBalanceCents: 100_000,
    });

    const totals = computeDocumentTotals(
      [{ quantity: 2, unitPriceCents: 10_000, vatRateBp: 1600 }],
      { vatEnabled: true }
    );

    const { invoice, session: updated } = await posApplication.createTicket(
      context.company,
      context.userId,
      {
        sessionId: session.id,
        lines: [{ productId, quantity: 2, description: "Article", unitPriceCents: 10_000 }],
        payments: [{ method: "CASH", amountCents: totals.totalTtcCents }],
      }
    );

    expect(invoice.source).toBe("POS");
    expect(invoice.status).toBe("PAID");
    expect(updated.ticketCount).toBe(1);
    expect(updated.totalCashCents).toBe(totals.totalTtcCents);

    const closed = await posApplication.closeSession(context.company, {
      sessionId: session.id,
      closingBalanceCents: 100_000 + totals.totalTtcCents,
    });
    // Counted = opening float + cash collections ⇒ no difference.
    expect(closed.differenceCents).toBe(0);
  });

  it("rejects a payment that does not cover the ticket total", async () => {
    const session = await posApplication.openSession(context.company, context.userId, {
      registerId: context.registerId,
      openingBalanceCents: 0,
    });

    await expect(
      posApplication.createTicket(context.company, context.userId, {
        sessionId: session.id,
        lines: [{ productId, quantity: 1, description: "Article", unitPriceCents: 10_000 }],
        payments: [{ method: "CASH", amountCents: 1 }],
      })
    ).rejects.toMatchObject({ code: "POS_PAYMENT_MISMATCH" });

    await posApplication.closeSession(context.company, {
      sessionId: session.id,
      closingBalanceCents: 0,
    });
  });
});

describe("overall accounting consistency", () => {
  it("keeps the journal, general ledger and trial balance in agreement", async () => {
    const entries = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, context.company.id));
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.companyId, context.company.id));

    // Each entry is balanced…
    for (const entry of entries) {
      expect(entry.totalDebitCents).toBe(entry.totalCreditCents);
    }

    // …and so is the sum of all lines.
    const totalDebit = lines.reduce((sum, line) => sum + line.debitCents, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.creditCents, 0);
    expect(totalDebit).toBe(totalCredit);

    // The trial balance returned by the API reproduces these totals exactly.
    const balance = await accountingRepository.balance(context.company.id, {
      toDate: todayInput(),
    });
    const balanceDebit = balance.reduce((sum, row) => sum + row.debitCents, 0);
    const balanceCredit = balance.reduce((sum, row) => sum + row.creditCents, 0);
    expect(balanceDebit).toBe(totalDebit);
    expect(balanceCredit).toBe(totalCredit);
  });
});
