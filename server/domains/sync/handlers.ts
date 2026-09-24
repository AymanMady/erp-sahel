/**
 * Ingestion handlers for offline operations.
 *
 * Each handler **replays the online use case** — never a direct `INSERT`. This guarantees
 * that an invoice created at the counter without network produces exactly the same
 * effects (stock, accounting entry, legal number) as an invoice entered online: there
 * are not two business paths to maintain (`SYNC_STRATEGY.md` §4).
 */

import {
  SYNC_PAYLOAD_SCHEMAS,
  type SyncDocumentLine,
  type SyncEntity,
} from "@shared/sync-protocol";
import type { RawDocumentLine } from "../../shared/documents/line-builder";
import { tr } from "../../shared/i18n";
import { catalogApplication } from "../catalog/application";
import { inventoryApplication } from "../inventory/application";
import { invoicingApplication } from "../invoicing/application";
import { partiesApplication } from "../parties/application";
import { paymentsApplication } from "../payments/application";
import { posApplication } from "../pos/application";
import { salesApplication } from "../sales/application";
import { syncDispatcher, type SyncHandlerContext } from "./dispatcher";

/** Validates the payload against the entity's shared schema. */
function parsePayload<E extends SyncEntity>(entity: E, payload: Record<string, unknown>) {
  return SYNC_PAYLOAD_SCHEMAS[entity].parse(payload) as ReturnType<
    (typeof SYNC_PAYLOAD_SCHEMAS)[E]["parse"]
  >;
}

/** Resolves `xxxId` or its `xxxClientUuid` counterpart created in the same offline batch. */
async function resolveReference(
  context: SyncHandlerContext,
  directId: string | null | undefined,
  clientUuid: string | null | undefined
): Promise<string | null> {
  if (directId) return directId;
  if (clientUuid) return context.resolveRef(clientUuid);
  return null;
}

/** Converts protocol lines into document lines, products included. */
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
    {
      ...data,
      imageUrls: [],
      variants: [],
      minStock: String(data.minStock),
    },
    context.userId
  );
  return { serverId: product.id, assignedNumber: product.sku };
});

syncDispatcher.register("sales.quote", async (context, payload) => {
  const data = parsePayload("sales.quote", payload);
  const partyId = await resolveReference(context, data.partyId, data.partyClientUuid);
  if (!partyId) throw new Error(tr("The quote does not reference any customer."));
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
      // An offline sale is a done deal at the counter: it arrives validated, which
      // triggers stock and accounting on ingestion ([FR-SYNC-4]).
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
   * A receipt cashed offline carries no customer: the invoice was attached to the
   * walk-in customer on ingestion. The payment must therefore reuse the party **of the
   * invoice**, rather than require a customer to have been entered at the counter.
   */
  const partyId =
    (await resolveReference(context, data.partyId, data.partyClientUuid)) ??
    (invoiceId
      ? (await invoicingApplication.get(context.company.id, invoiceId, context.tx)).partyId
      : null);

  if (!partyId) {
    throw new Error(
      tr("The payment references neither a party nor an invoice: it cannot be allocated.")
    );
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
  if (!sessionId) throw new Error(tr("The closing does not reference any session."));
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
    direction: data.direction ?? undefined,
    quantity: data.quantity,
    unitCostCents: data.unitCostCents ?? undefined,
    lotNumber: data.lotNumber,
    reason: data.reason,
    originType: "manual",
    userId: context.userId,
    clientUuid: context.clientUuid,
  });
  return { serverId: movement.id };
});

/** Entities actually accepted by the server — exposed by the snapshot. */
export function registeredSyncEntities(): string[] {
  return syncDispatcher.entities();
}
