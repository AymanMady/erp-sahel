/**
 * Test central du mode hors ligne : **une opération synchronisée l'est exactement une
 * fois** ([BR-8], [FR-SYNC-4], §16.3 et §17 du cahier des charges).
 *
 * Le scénario reproduit la panne réelle : un poste encaisse hors ligne, le réseau
 * revient, le lot part — puis part **une seconde fois** parce que la réponse s'est
 * perdue. Aucun doublon ne doit apparaître, ni en facture, ni en stock, ni en
 * comptabilité.
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
 * `clientUuid` de la session ouverte hors ligne, partagée par tous les lots du test.
 * Une caisse n'accepte qu'une session ouverte à la fois — c'est une règle du produit,
 * pas une limite du test : chaque lot réutilise donc la même.
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
          notes: "Session hors ligne",
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
 * Lot typique d'un poste hors ligne : un ticket et son règlement, rattachés à la
 * session ouverte au démarrage. Aucun client n'est saisi — cas le plus courant au
 * comptoir, et celui qui exige que le règlement reprenne le tiers de la facture.
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
              description: "Article de test",
              productSku: "ART",
              quantity: 3,
              unit: "pièce",
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

describe("ingestion d'un lot hors ligne", () => {
  it("crée la chaîne complète et attribue un numéro légal", async () => {
    const batch = buildOfflineBatch();
    const results = await syncApplication.push(
      { company: context.company, userId: context.userId, deviceId: "poste-test" },
      batch.operations
    );

    expect(results.map((result) => result.status)).toEqual(["created", "created"]);

    const invoiceResult = results.find((result) => result.entity === "invoicing.sales_invoice");
    // Le numéro provisoire du poste est remplacé par un numéro légal séquentiel.
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

  it("ne duplique rien lorsque le même lot est rejoué", async () => {
    const batch = buildOfflineBatch();
    const identity = {
      company: context.company,
      userId: context.userId,
      deviceId: "poste-test",
    };

    const first = await syncApplication.push(identity, batch.operations);
    expect(first.every((result) => result.status === "created")).toBe(true);

    // Rejeu intégral du même lot — exactement ce qui se produit après un timeout réseau.
    const second = await syncApplication.push(identity, batch.operations);
    expect(second.every((result) => result.status === "duplicate")).toBe(true);

    // Les identifiants renvoyés au rejeu sont ceux de la première ingestion.
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

    // La session ouverte hors ligne reste unique, malgré les rejeux.
    const sessions = await db
      .select()
      .from(posSessions)
      .where(eq(posSessions.clientUuid, sessionUuid));
    expect(sessions).toHaveLength(1);
  });

  it("ne décrémente le stock qu'une seule fois", async () => {
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

    // Trois envois du même lot, une seule sortie de 3 unités.
    expect(Number(after.quantity)).toBe(quantityBefore - 3);
  });

  it("produit des écritures comptables équilibrées, sans doublon", async () => {
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

    // Une facture ⇒ une écriture de vente ; un règlement ⇒ une écriture de caisse.
    const salesEntries = entries.filter((entry) => entry.originType === "sales_invoice");
    const paymentEntries = entries.filter((entry) => entry.originType === "payment");
    // Autant d'écritures de vente que de factures réellement créées — les rejeux
    // n'en ajoutent aucune.
    const invoiceCount = (
      await db.select().from(salesInvoices).where(eq(salesInvoices.companyId, context.company.id))
    ).length;
    expect(salesEntries).toHaveLength(invoiceCount);
    expect(paymentEntries.length).toBe(salesEntries.length);
  });

  it("reporte une opération dont la dépendance n'est pas encore ingérée", async () => {
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
          // Le client référencé n'a jamais été envoyé : la dépendance est introuvable.
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
                unit: "pièce",
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

    // Un report ne doit rien écrire : l'opération doit rester rejouable telle quelle.
    const invoices = await db
      .select()
      .from(salesInvoices)
      .where(eq(salesInvoices.clientUuid, orphanInvoiceUuid));
    expect(invoices).toHaveLength(0);
  });

  it("résout une référence créée dans le même lot", async () => {
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
          payload: { name: "Client créé hors ligne", partyType: "CUSTOMER" },
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
                unit: "pièce",
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
