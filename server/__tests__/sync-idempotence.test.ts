/**
 * Core test of offline mode: **a synchronized operation is applied exactly once**
 * ([BR-8], [FR-SYNC-4], §16.3 and §17 of the specification).
 *
 * The scenario reproduces the real failure: a device takes payments offline, the
 * network comes back, the batch is sent — then sent **a second time** because the
 * response was lost. No duplicate may appear, in invoices, in stock or in accounting.
 */

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayInput } from "@shared/format";
import type { SyncOperationInput } from "@shared/sync-protocol";
import {
  journalEntries,
  journalLines,
  payments,
  posSessions,
  salesInvoices,
  stockItems,
} from "@shared/schema";
import { closeDatabase, db } from "../db";
import { syncApplication } from "../domains/sync/application";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

let context: TestContext;
let productId: string;
/**
 * `clientUuid` of the session opened offline, shared by every batch of the test.
 * A register accepts only one open session at a time — a product rule, not a test
 * limitation: every batch therefore reuses the same one.
 */
let sessionUuid: string;

beforeAll(async () => {
  context = await createTestCompany("sync");
  const product = await createStockedProduct(context, { salePriceCents: 10_000, quantity: 100 });
  productId = product.id;

  sessionUuid = randomUUID();
  await syncApplication.push(
    { company: context.company, userId: context.userId, deviceId: "poste-test" },
    [
      {
        clientUuid: sessionUuid,
        localSeq: 0,
        entity: "pos.session_open",
        action: "create",
        dependsOn: [],
        createdAt: new Date().toISOString(),
        payload: {
          registerId: context.registerId,
          openingBalanceCents: 500_000,
          openedAt: new Date().toISOString(),
          notes: "Offline session",
        },
      },
    ]
  );
});

afterAll(async () => {
  await dropTestCompany(context);
  await closeDatabase();
});

/**
 * Typical batch of an offline device: a ticket and its payment, linked to the session
 * opened at startup. No customer is entered — the most common case at the counter, and
 * the one that requires the payment to take over the invoice's party.
 */
function buildOfflineBatch(): {
  operations: SyncOperationInput[];
  invoiceUuid: string;
  paymentUuid: string;
} {
  const invoiceUuid = randomUUID();
  const paymentUuid = randomUUID();
  const date = todayInput();

  return {
    invoiceUuid,
    paymentUuid,
    operations: [
      {
        clientUuid: invoiceUuid,
        localSeq: 2,
        entity: "invoicing.sales_invoice",
        action: "create",
        dependsOn: [sessionUuid],
        createdAt: new Date().toISOString(),
        payload: {
          posSessionClientUuid: sessionUuid,
          source: "POS",
          date,
          globalDiscountBp: 0,
          notes: "",
          provisionalNumber: "OFFLINE-TKT-0001",
          lines: [
            {
              productId,
              description: "Test item",
              productSku: "ART",
              quantity: 3,
              unit: "piece",
              unitPriceCents: 10_000,
              discountBp: 0,
              vatRateBp: 1600,
              originCountry: "",
            },
          ],
        },
      },
      {
        clientUuid: paymentUuid,
        localSeq: 3,
        entity: "payments.payment",
        action: "create",
        dependsOn: [invoiceUuid],
        createdAt: new Date().toISOString(),
        payload: {
          invoiceClientUuid: invoiceUuid,
          posSessionClientUuid: sessionUuid,
          amountCents: 34_800,
          paymentDate: date,
          paymentMethod: "CASH",
          reference: "OFFLINE-TKT-0001",
          notes: "",
        },
      },
    ],
  };
}

describe("offline batch ingestion", () => {
  it("creates the full chain and assigns a legal number", async () => {
    const batch = buildOfflineBatch();
    const results = await syncApplication.push(
      { company: context.company, userId: context.userId, deviceId: "poste-test" },
      batch.operations
    );

    expect(results.map((result) => result.status)).toEqual(["created", "created"]);

    const invoiceResult = results.find((result) => result.entity === "invoicing.sales_invoice");
    // The device's provisional number is replaced by a sequential legal number.
    expect(invoiceResult?.assignedNumber).toMatch(/^FAC-\d{4}-\d{4}$/);

    const [invoice] = await db
      .select()
      .from(salesInvoices)
      .where(eq(salesInvoices.clientUuid, batch.invoiceUuid));
    expect(invoice.status).toBe("PAID");
    expect(invoice.totalTtcCents).toBe(34_800);
    expect(invoice.provisionalNumber).toBe("OFFLINE-TKT-0001");
    expect(invoice.isLocked).toBe(true);
  });

  it("duplicates nothing when the same batch is replayed", async () => {
    const batch = buildOfflineBatch();
    const identity = {
      company: context.company,
      userId: context.userId,
      deviceId: "poste-test",
    };

    const first = await syncApplication.push(identity, batch.operations);
    expect(first.every((result) => result.status === "created")).toBe(true);

    // Full replay of the same batch — exactly what happens after a network timeout.
    const second = await syncApplication.push(identity, batch.operations);
    expect(second.every((result) => result.status === "duplicate")).toBe(true);

    // The ids returned on replay are those of the first ingestion.
    for (const [index, result] of second.entries()) {
      expect(result.serverId).toBe(first[index].serverId);
    }

    const invoices = await db
      .select()
      .from(salesInvoices)
      .where(eq(salesInvoices.clientUuid, batch.invoiceUuid));
    expect(invoices).toHaveLength(1);

    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.clientUuid, batch.paymentUuid));
    expect(paymentRows).toHaveLength(1);

    // The session opened offline stays unique despite the replays.
    const sessions = await db
      .select()
      .from(posSessions)
      .where(eq(posSessions.clientUuid, sessionUuid));
    expect(sessions).toHaveLength(1);
  });

  it("decrements stock only once", async () => {
    const [before] = await db
      .select()
      .from(stockItems)
      .where(
        and(eq(stockItems.companyId, context.company.id), eq(stockItems.productId, productId))
      );
    const quantityBefore = Number(before.quantity);

    const batch = buildOfflineBatch();
    const identity = { company: context.company, userId: context.userId, deviceId: "poste-test" };

    await syncApplication.push(identity, batch.operations);
    await syncApplication.push(identity, batch.operations);
    await syncApplication.push(identity, batch.operations);

    const [after] = await db
      .select()
      .from(stockItems)
      .where(
        and(eq(stockItems.companyId, context.company.id), eq(stockItems.productId, productId))
      );

    // Three sends of the same batch, a single outgoing movement of 3 units.
    expect(Number(after.quantity)).toBe(quantityBefore - 3);
  });

  it("produces balanced journal entries, without duplicates", async () => {
    const batch = buildOfflineBatch();
    const identity = { company: context.company, userId: context.userId, deviceId: "poste-test" };

    await syncApplication.push(identity, batch.operations);
    await syncApplication.push(identity, batch.operations);

    const entries = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, context.company.id));

    for (const entry of entries) {
      expect(entry.totalDebitCents).toBe(entry.totalCreditCents);
    }

    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.companyId, context.company.id));
    const totalDebit = lines.reduce((sum, line) => sum + line.debitCents, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.creditCents, 0);
    expect(totalDebit).toBe(totalCredit);

    // One invoice ⇒ one sales entry; one payment ⇒ one cash entry.
    const salesEntries = entries.filter((entry) => entry.originType === "sales_invoice");
    const paymentEntries = entries.filter((entry) => entry.originType === "payment");
    // As many sales entries as invoices actually created — replays add none.
    const invoiceCount = (
      await db.select().from(salesInvoices).where(eq(salesInvoices.companyId, context.company.id))
    ).length;
    expect(salesEntries).toHaveLength(invoiceCount);
    expect(paymentEntries.length).toBe(salesEntries.length);
  });

  it("defers an operation whose dependency is not ingested yet", async () => {
    const orphanInvoiceUuid = randomUUID();
    const missingPartyUuid = randomUUID();

    const [result] = await syncApplication.push(
      { company: context.company, userId: context.userId, deviceId: "poste-test" },
      [
        {
          clientUuid: orphanInvoiceUuid,
          localSeq: 99,
          entity: "invoicing.sales_invoice",
          action: "create",
          // The referenced customer was never sent: the dependency cannot be found.
          dependsOn: [missingPartyUuid],
          createdAt: new Date().toISOString(),
          payload: {
            partyClientUuid: missingPartyUuid,
            source: "POS",
            date: todayInput(),
            globalDiscountBp: 0,
            notes: "",
            provisionalNumber: "OFFLINE-TKT-9999",
            lines: [
              {
                productId,
                description: "Article",
                quantity: 1,
                unit: "piece",
                unitPriceCents: 10_000,
                discountBp: 0,
                vatRateBp: 1600,
              },
            ],
          },
        },
      ]
    );

    expect(result.status).toBe("deferred");

    // A deferral must write nothing: the operation must stay replayable as is.
    const invoices = await db
      .select()
      .from(salesInvoices)
      .where(eq(salesInvoices.clientUuid, orphanInvoiceUuid));
    expect(invoices).toHaveLength(0);
  });

  it("resolves a reference created in the same batch", async () => {
    const partyUuid = randomUUID();
    const invoiceUuid = randomUUID();

    const results = await syncApplication.push(
      { company: context.company, userId: context.userId, deviceId: "poste-test" },
      [
        {
          clientUuid: partyUuid,
          localSeq: 200,
          entity: "core.party",
          action: "create",
          dependsOn: [],
          createdAt: new Date().toISOString(),
          payload: { name: "Customer created offline", partyType: "CUSTOMER" },
        },
        {
          clientUuid: invoiceUuid,
          localSeq: 201,
          entity: "invoicing.sales_invoice",
          action: "create",
          dependsOn: [partyUuid],
          createdAt: new Date().toISOString(),
          payload: {
            partyClientUuid: partyUuid,
            source: "POS",
            date: todayInput(),
            globalDiscountBp: 0,
            notes: "",
            provisionalNumber: "OFFLINE-TKT-0002",
            lines: [
              {
                productId,
                description: "Article",
                quantity: 1,
                unit: "piece",
                unitPriceCents: 10_000,
                discountBp: 0,
                vatRateBp: 1600,
              },
            ],
          },
        },
      ]
    );

    expect(results.every((result) => result.status === "created")).toBe(true);

    const [invoice] = await db
      .select()
      .from(salesInvoices)
      .where(eq(salesInvoices.clientUuid, invoiceUuid));
    expect(invoice.partyId).toBe(results[0].serverId);
  });
});
