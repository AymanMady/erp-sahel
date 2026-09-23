/**
 * Handlers d'ingestion des opérations hors-ligne.
 *
 * Chaque handler **rejoue le cas d'usage en ligne** — jamais un `INSERT` direct. C'est
 * la garantie qu'une facture créée au comptoir sans réseau produit exactement les mêmes
 * effets (stock, écriture, numéro légal) qu'une facture saisie en ligne : il n'existe
 * pas deux chemins métier à maintenir (`SYNC_STRATEGY.md` §4).
 */

import {
  SYNC_PAYLOAD_SCHEMAS,
  type SyncDocumentLine,
  type SyncEntity,
} from "@shared/sync-protocol";
import type { RawDocumentLine } from "../../shared/documents/line-builder";
import { catalogApplication } from "../catalog/application";
import { inventoryApplication } from "../inventory/application";
import { invoicingApplication } from "../invoicing/application";
import { partiesApplication } from "../parties/application";
import { paymentsApplication } from "../payments/application";
import { posApplication } from "../pos/application";
import { salesApplication } from "../sales/application";
import { syncDispatcher, type SyncHandlerContext } from "./dispatcher";

/** Valide le payload contre le schéma partagé de l'entité. */
function parsePayload<E extends SyncEntity>(entity: E, payload: Record<string, unknown>) {
  return SYNC_PAYLOAD_SCHEMAS[entity].parse(payload) as ReturnType<
    (typeof SYNC_PAYLOAD_SCHEMAS)[E]["parse"]
  >;
}

/** Résout `xxxId` ou son équivalent `xxxClientUuid` créé dans le même lot hors-ligne. */
async function resolveReference(
  context: SyncHandlerContext,
  directId: string | null | undefined,
  clientUuid: string | null | undefined
): Promise<string | null> {
  if (directId) return directId;
  if (clientUuid) return context.resolveRef(clientUuid);
  return null;
}

/** Convertit les lignes du protocole en lignes de document, produits inclus. */
async function resolveLines(
  context: SyncHandlerContext,
  lines: SyncDocumentLine[]
): Promise<RawDocumentLine[]> {
  const resolved: RawDocumentLine[] = [];
  for (const line of lines) {
    resolved.push({
      productId: await resolveReference(context, line.productId, line.productClientUuid),
      variantId: line.variantId ?? null,
      serviceId: line.serviceId ?? null,
      productSku: line.productSku,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp,
      vatRateBp: line.vatRateBp,
      originCountry: line.originCountry,
    });
  }
  return resolved;
}

syncDispatcher.register("core.party", async (context, payload) => {
  const data = parsePayload("core.party", payload);
  const party = await partiesApplication.create(
    context.company.id,
    { ...data, clientUuid: context.clientUuid },
    context.tx
  );
  return { serverId: party.id, assignedNumber: party.code };
});

syncDispatcher.register("catalog.product", async (context, payload) => {
  const data = parsePayload("catalog.product", payload);
  const product = await catalogApplication.create(
    context.company.id,
    { ...data, profileType: "GENERIC", imageUrls: [], variants: [], minStock: "0" },
    context.userId
  );
  return { serverId: product.id, assignedNumber: product.sku };
});

syncDispatcher.register("sales.quote", async (context, payload) => {
  const data = parsePayload("sales.quote", payload);
  const partyId = await resolveReference(context, data.partyId, data.partyClientUuid);
  if (!partyId) throw new Error("Le devis ne référence aucun client.");
  const quote = await salesApplication.createQuote(
    context.company,
    {
      partyId,
      date: data.date,
      expiryDate: data.expiryDate,
      globalDiscountBp: data.globalDiscountBp,
      notes: data.notes,
      clientUuid: context.clientUuid,
      lines: await resolveLines(context, data.lines),
    },
    context.userId,
    context.tx
  );
  return { serverId: quote.id, assignedNumber: quote.number };
});

syncDispatcher.register("invoicing.sales_invoice", async (context, payload) => {
  const data = parsePayload("invoicing.sales_invoice", payload);
  const partyId =
    (await resolveReference(context, data.partyId, data.partyClientUuid)) ??
    (await partiesApplication.ensureWalkInCustomer(context.company.id, context.tx)).id;
  const posSessionId = await resolveReference(
    context,
    data.posSessionId,
    data.posSessionClientUuid
  );

  const invoice = await invoicingApplication.createInTx(
    context.tx,
    context.company,
    {
      partyId,
      warehouseId: data.warehouseId,
      source: data.source,
      posSessionId,
      date: data.date,
      dueDate: data.dueDate,
      globalDiscountBp: data.globalDiscountBp,
      notes: data.notes,
      provisionalNumber: data.provisionalNumber,
      clientUuid: context.clientUuid,
      lines: await resolveLines(context, data.lines),
      // Une vente hors-ligne est un fait accompli au comptoir : elle arrive validée,
      // ce qui déclenche stock et comptabilité à l'ingestion ([FR-SYNC-4]).
      validate: true,
    },
    context.userId
  );
  return { serverId: invoice.id, assignedNumber: invoice.number };
});

syncDispatcher.register("payments.payment", async (context, payload) => {
  const data = parsePayload("payments.payment", payload);
  const invoiceId = await resolveReference(context, data.invoiceId, data.invoiceClientUuid);

  /**
   * Un ticket de caisse encaissé hors ligne ne porte pas de client : la facture a été
   * rattachée au client de passage à l'ingestion. Le règlement doit donc reprendre le
   * tiers **de la facture**, et non exiger qu'un client ait été saisi au comptoir.
   */
  const partyId =
    (await resolveReference(context, data.partyId, data.partyClientUuid)) ??
    (invoiceId
      ? (await invoicingApplication.get(context.company.id, invoiceId, context.tx)).partyId
      : null);

  if (!partyId) {
    throw new Error("Le règlement ne référence ni tiers ni facture : impossible de l'imputer.");
  }

  const payment = await paymentsApplication.createInTx(
    context.tx,
    context.company,
    {
      partyId,
      invoiceId,
      bankAccountId: data.bankAccountId,
      posSessionId: await resolveReference(context, data.posSessionId, data.posSessionClientUuid),
      amountCents: data.amountCents,
      paymentDate: data.paymentDate,
      paymentMethod: data.paymentMethod,
      reference: data.reference,
      notes: data.notes,
      clientUuid: context.clientUuid,
    },
    context.userId
  );
  return { serverId: payment.id, assignedNumber: payment.number };
});

syncDispatcher.register("pos.session_open", async (context, payload) => {
  const data = parsePayload("pos.session_open", payload);
  const session = await posApplication.openSession(
    context.company,
    context.userId,
    { ...data, clientUuid: context.clientUuid },
    context.tx
  );
  return { serverId: session.id };
});

syncDispatcher.register("pos.session_close", async (context, payload) => {
  const data = parsePayload("pos.session_close", payload);
  const sessionId = await resolveReference(context, data.sessionId, data.sessionClientUuid);
  if (!sessionId) throw new Error("La clôture ne référence aucune session.");
  const session = await posApplication.closeSession(
    context.company,
    {
      sessionId,
      closingBalanceCents: data.closingBalanceCents,
      closedAt: data.closedAt,
      notes: data.notes,
    },
    context.tx
  );
  return { serverId: session.id };
});

syncDispatcher.register("inventory.stock_movement", async (context, payload) => {
  const data = parsePayload("inventory.stock_movement", payload);
  const movement = await inventoryApplication.applyMovement(context.tx, {
    companyId: context.company.id,
    productId: data.productId,
    warehouseId: data.warehouseId,
    movementType: data.movementType,
    quantity: data.quantity,
    lotNumber: data.lotNumber,
    reason: data.reason,
    originType: "manual",
    userId: context.userId,
    clientUuid: context.clientUuid,
  });
  return { serverId: movement.id };
});

/** Entités effectivement acceptées par le serveur — exposé par l'instantané. */
export function registeredSyncEntities(): string[] {
  return syncDispatcher.entities();
}
