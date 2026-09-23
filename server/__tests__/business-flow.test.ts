/**
 * Chaîne métier de bout en bout (§16.2 et §17 du cahier des charges) :
 *
 *   produit → facture → décrément de stock → règlement → écriture au journal
 *   → grand livre → balance
 *
 * Chaque étape vérifie l'invariant qui lui est propre ([BR-6], [BR-7], [BR-10]).
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
    { name: "Client intégration", partyType: "CUSTOMER" },
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

describe("facture de vente", () => {
  it("laisse le stock intact tant qu'elle est en brouillon", async () => {
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

    // Un brouillon ne consomme pas de numéro légal.
    expect(invoice.number.startsWith("BR-")).toBe(true);
  });

  it("décrémente le stock et comptabilise à la validation", async () => {
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

    // Un mouvement de sortie est tracé, rattaché à la facture.
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

    // L'écriture de vente est équilibrée.
    const entry = await accountingRepository.findEntryByOrigin(
      context.company.id,
      "sales_invoice",
      validated.id
    );
    expect(entry).not.toBeNull();
    expect(entry?.totalDebitCents).toBe(entry?.totalCreditCents);
    expect(entry?.totalDebitCents).toBe(validated.totalTtcCents);
  });

  it("refuse toute modification après validation", async () => {
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
    ).rejects.toThrow(/inaltérable/i);
  });

  it("refuse de vendre plus que le stock disponible", async () => {
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
    ).rejects.toThrow(/stock insuffisant/i);
  });
});

describe("règlement", () => {
  it("solde la facture, alimente la trésorerie et passe l'écriture", async () => {
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

  it("refuse un règlement supérieur au reste à payer", async () => {
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
    ).rejects.toThrow(/dépasse le reste à payer/i);
  });

  it("marque la facture partiellement payée sur un acompte", async () => {
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

describe("avoir", () => {
  it("réintègre le stock et passe l'écriture inverse", async () => {
    const draft = await invoicingApplication.create(
      context.company,
      { partyId: customerId, lines: [{ productId, quantity: 3, description: "Article" }] },
      context.userId
    );
    const invoice = await invoicingApplication.validate(context.company, draft.id, context.userId);
    const afterInvoice = await stockOf();

    const creditNote = await invoicingApplication.createCreditNote(
      context.company,
      { invoiceId: invoice.id, reason: "Retour client", restock: true },
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

  it("refuse un avoir sur un brouillon", async () => {
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
    ).rejects.toThrow(/validée/i);
  });
});

describe("chaîne devis → commande → facture", () => {
  it("convertit sans perte de montant", async () => {
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
    // La facture issue d'une commande naît en brouillon : elle doit être validée.
    expect(invoice.status).toBe("DRAFT");

    const refreshedQuote = await salesApplication.getQuote(context.company.id, quote.id);
    expect(refreshedQuote.status).toBe("CONVERTED");
  });

  it("refuse de convertir deux fois le même devis", async () => {
    const quote = await salesApplication.createQuote(
      context.company,
      { partyId: customerId, lines: [{ productId, quantity: 1, description: "Article" }] },
      context.userId
    );
    await salesApplication.convertQuoteToOrder(context.company, quote.id, context.userId);
    await expect(
      salesApplication.convertQuoteToOrder(context.company, quote.id, context.userId)
    ).rejects.toThrow(/déjà été converti/i);
  });
});

describe("achat : commande → réception", () => {
  it("fait entrer la marchandise en stock au coût indiqué", async () => {
    const supplier = await partiesApplication.create(
      context.company.id,
      { name: "Fournisseur intégration", partyType: "SUPPLIER" },
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

describe("caisse", () => {
  it("encaisse un ticket complet et met à jour la session", async () => {
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
    // Compté = fond de caisse + encaissements espèces ⇒ aucun écart.
    expect(closed.differenceCents).toBe(0);
  });

  it("refuse un encaissement qui ne couvre pas le total du ticket", async () => {
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
    ).rejects.toThrow(/doit être égal/i);

    await posApplication.closeSession(context.company, {
      sessionId: session.id,
      closingBalanceCents: 0,
    });
  });
});

describe("cohérence comptable globale", () => {
  it("laisse le journal, le grand livre et la balance en accord", async () => {
    const entries = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, context.company.id));
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.companyId, context.company.id));

    // Chaque écriture est équilibrée…
    for (const entry of entries) {
      expect(entry.totalDebitCents).toBe(entry.totalCreditCents);
    }

    // …et le cumul des lignes l'est aussi.
    const totalDebit = lines.reduce((sum, line) => sum + line.debitCents, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.creditCents, 0);
    expect(totalDebit).toBe(totalCredit);

    // La balance renvoyée par l'API reproduit exactement ces totaux.
    const balance = await accountingRepository.balance(context.company.id, {
      toDate: todayInput(),
    });
    const balanceDebit = balance.reduce((sum, row) => sum + row.debitCents, 0);
    const balanceCredit = balance.reduce((sum, row) => sum + row.creditCents, 0);
    expect(balanceDebit).toBe(totalDebit);
    expect(balanceCredit).toBe(totalCredit);
  });
});
