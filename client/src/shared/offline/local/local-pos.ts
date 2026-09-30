/**
 * The till on the offline-first desktop: a sale is written to the local database — the
 * ticket, its payments, and their operations — **in one transaction**, with no network
 * call. The engine sends them; the server replays the online use case (legal number,
 * stock, accounting) and its answer replaces the provisional ticket.
 *
 * What the server computes from a sale — the stock left, the totals of the session —
 * is reflected here as **derived** rows: shown at once, never blocking the server's own
 * figure, which the next pull brings (`local_db` `derived`).
 *
 * Same payloads as the former offline checkout (`features/pos/checkout.ts`): the server
 * sees no difference.
 */

import type { PaymentMethod, PosSession } from "@shared/schema";
import { formatProvisionalNumber } from "@shared/numbering-helpers";
import { normalizeQuantity } from "@shared/money";
import { computeDocumentTotals } from "@shared/pricing";
import { todayInput } from "@shared/format";
import { ApiError } from "@/shared/api/api-error";
import { getCachedSession } from "@/shared/auth/token-store";
import { i18n } from "@/shared/i18n";
import { newUuid } from "../outbox";
import { localCompanyId, localDb, type QueueEntryInput, type RowWrite } from "./local-db";
import { isLocalReady } from "./replication";

type Row = Record<string, unknown>;

/** Everything a sale touches: the till works locally only when all of it is here. */
const TILL_ENTITIES = [
  "pos_registers",
  "pos_sessions",
  "sales_invoices",
  "payments",
  "stock_items",
] as const;

export function isLocalTillReady(): boolean {
  return TILL_ENTITIES.every(isLocalReady);
}

function companyId(): string {
  const id = localCompanyId();
  if (!id) throw new Error("The local database is not open.");
  return id;
}

function currentUserId(): string | null {
  return getCachedSession()?.user?.id ?? null;
}

async function one(
  entity: (typeof TILL_ENTITIES)[number] | "parties",
  id: string
): Promise<{
  data: Row;
  version: number;
} | null> {
  const [row] = await localDb.get<Row>(entity, [id]);
  return row ? { data: row.data, version: row.version } : null;
}

/**
 * A reference to a row: its id once the server has it, otherwise its creation's id as
 * a `…ClientUuid` plus a dependency — the operation waits for the creation instead of
 * failing on a row the server does not know yet.
 */
function reference(id: string | null | undefined, version: number | undefined) {
  if (!id) return { id: null, clientUuid: null, dependsOn: [] as string[] };
  return version === 0
    ? { id: null, clientUuid: id, dependsOn: [id] }
    : { id, clientUuid: null, dependsOn: [] as string[] };
}

// ─── Session ──────────────────────────────────────────────────────────────────

/** `GET /api/pos/sessions/current`: this person's latest open session. */
export async function currentSessionLocal(): Promise<PosSession | null> {
  const userId = currentUserId();
  if (!userId) return null;
  const { rows } = await localDb.query<PosSession>({
    entity: "pos_sessions",
    filters: [
      { column: "user_id", op: "eq", value: userId },
      { column: "status", op: "eq", value: "OPEN" },
    ],
    orderBy: [{ column: "json:openedAt", desc: true }],
    limit: 1,
  });
  return rows[0]?.data ?? null;
}

/** Payments of a session, as `payments/repository.ts` `sessionTotals` counts them. */
async function sessionTotals(sessionId: string) {
  const { rows } = await localDb.query<Row>({
    entity: "payments",
    filters: [
      { column: "pos_session_id", op: "eq", value: sessionId },
      { column: "json:direction", op: "eq", value: "IN" },
      { column: "json:status", op: "eq", value: "CONFIRMED" },
    ],
  });
  const byMethod = new Map<string, { paymentMethod: string; totalCents: number; count: number }>();
  for (const { data } of rows) {
    const method = String(data.paymentMethod);
    const entry = byMethod.get(method) ?? { paymentMethod: method, totalCents: 0, count: 0 };
    entry.totalCents += Number(data.amountCents);
    entry.count += 1;
    byMethod.set(method, entry);
  }
  const list = [...byMethod.values()];
  return {
    byMethod: list,
    totalCents: list.reduce((sum, entry) => sum + entry.totalCents, 0),
    cashCents: byMethod.get("CASH")?.totalCents ?? 0,
  };
}

/** `GET /api/pos/sessions/:id` (`pos/application.ts` `sessionSummary`), sales made here included. */
export async function sessionSummaryLocal(sessionId: string) {
  const session = await one("pos_sessions", sessionId);
  if (!session) {
    throw new ApiError({ status: 404, code: "NOT_FOUND", message: i18n.t("pos:sessionNotFound") });
  }
  const data = session.data as unknown as PosSession;
  const totals = await sessionTotals(sessionId);
  return {
    ...data,
    totals,
    expectedBalanceCents: data.openingBalanceCents + totals.cashCents,
    differenceCents:
      data.status === "CLOSED" ? data.closingBalanceCents - data.expectedBalanceCents : 0,
  };
}

export async function openSessionLocal(input: {
  registerId: string;
  openingBalanceCents: number;
  notes?: string;
}): Promise<{ sessionId: string }> {
  const id = newUuid();
  const now = new Date().toISOString();
  const data: Row = {
    id,
    companyId: companyId(),
    registerId: input.registerId,
    userId: currentUserId(),
    openedAt: now,
    closedAt: null,
    openingBalanceCents: input.openingBalanceCents,
    closingBalanceCents: 0,
    expectedBalanceCents: input.openingBalanceCents,
    totalSalesCents: 0,
    totalCashCents: 0,
    ticketCount: 0,
    status: "OPEN",
    notes: input.notes ?? "",
    clientUuid: id,
    isActive: true,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
  await localDb.write({
    rows: [{ entity: "pos_sessions", id, version: 0, data }],
    queue: [
      {
        id,
        entity: "pos.session_open",
        localTable: "pos_sessions",
        entityId: id,
        operation: "CREATE",
        payload: {
          registerId: input.registerId,
          openingBalanceCents: input.openingBalanceCents,
          openedAt: now,
          notes: input.notes ?? "",
        },
        userId: currentUserId(),
        label: i18n.t("pos:outbox.sessionOpen"),
      },
    ],
  });
  return { sessionId: id };
}

/**
 * Closes a session here. The difference is computed on the sales known here — all of
 * this till's, since it sells locally — and computed again by the server on receipt.
 */
export async function closeSessionLocal(input: {
  sessionId: string;
  closingBalanceCents: number;
  notes?: string;
}): Promise<{ differenceCents: number }> {
  const session = await one("pos_sessions", input.sessionId);
  if (!session) {
    throw new ApiError({ status: 404, code: "NOT_FOUND", message: i18n.t("pos:sessionNotFound") });
  }
  const totals = await sessionTotals(input.sessionId);
  const expectedBalanceCents = Number(session.data.openingBalanceCents) + totals.cashCents;
  const closedAt = new Date().toISOString();
  const ref = reference(input.sessionId, session.version);
  await localDb.write({
    rows: [
      {
        entity: "pos_sessions",
        id: input.sessionId,
        data: {
          ...session.data,
          status: "CLOSED",
          closedAt,
          closingBalanceCents: input.closingBalanceCents,
          expectedBalanceCents,
          notes: input.notes ?? session.data.notes ?? "",
          updatedAt: closedAt,
        },
      },
    ],
    queue: [
      {
        id: newUuid(),
        entity: "pos.session_close",
        localTable: "pos_sessions",
        entityId: input.sessionId,
        operation: "UPDATE",
        payload: {
          sessionId: ref.id,
          sessionClientUuid: ref.clientUuid,
          closingBalanceCents: input.closingBalanceCents,
          closedAt,
          notes: input.notes ?? "",
        },
        dependsOn: ref.dependsOn,
        userId: currentUserId(),
        label: i18n.t("pos:outbox.sessionClose"),
      },
    ],
  });
  return { differenceCents: input.closingBalanceCents - expectedBalanceCents };
}

// ─── Sale ─────────────────────────────────────────────────────────────────────

export interface LocalSaleLine {
  productId: string | null;
  serviceId?: string | null;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  discountBp: number;
}

export interface LocalSalePayment {
  method: PaymentMethod;
  amountCents: number;
  reference?: string;
  bankAccountId?: string | null;
}

export interface LocalSaleInput {
  sessionId: string;
  partyId?: string | null;
  lines: LocalSaleLine[];
  payments: LocalSalePayment[];
  globalDiscountBp?: number;
  notes?: string;
  localTicketSeq: number;
}

/**
 * Records a sale: the ticket (a validated invoice with a provisional number), its
 * payments, and — derived — the stock left in the till's warehouse and the session
 * totals. One transaction: never a ticket without its payments, nor a payment without
 * its operation.
 */
export async function checkoutLocal(
  input: LocalSaleInput
): Promise<{ number: string; totalCents: number; invoiceId: string }> {
  const session = await one("pos_sessions", input.sessionId);
  if (!session || session.data.status !== "OPEN") {
    throw new ApiError({
      status: 409,
      code: "POS_SESSION_CLOSED",
      message: i18n.t("pos:toasts.sessionClosedElsewhere"),
    });
  }
  const register = await one("pos_registers", String(session.data.registerId));
  const party = input.partyId ? await one("parties", input.partyId) : null;
  const sessionRef = reference(input.sessionId, session.version);
  const partyRef = reference(input.partyId, party?.version);

  const date = todayInput();
  const now = new Date().toISOString();
  const number = formatProvisionalNumber("TKT", input.localTicketSeq);
  const invoiceId = newUuid();
  const priced = computeDocumentTotals(
    input.lines.map((line) => ({
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp,
    })),
    { globalDiscountBp: input.globalDiscountBp }
  );
  const paidCents = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const warehouseId = (register?.data.warehouseId as string | undefined) ?? null;
  const syncLines = input.lines.map((line) => ({
    productId: line.productId ?? null,
    serviceId: line.serviceId ?? null,
    description: line.name,
    productSku: line.sku,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
    discountBp: line.discountBp,
  }));

  const invoice: Row = {
    id: invoiceId,
    companyId: companyId(),
    number,
    provisionalNumber: number,
    partyId: input.partyId ?? null,
    salesOrderId: null,
    warehouseId,
    source: "POS",
    posSessionId: input.sessionId,
    date,
    dueDate: date,
    status:
      paidCents >= priced.totalCents ? "PAID" : paidCents > 0 ? "PARTIALLY_PAID" : "VALIDATED",
    globalDiscountBp: input.globalDiscountBp ?? 0,
    totalCents: priced.totalCents,
    paidAmountCents: Math.min(paidCents, priced.totalCents),
    creditedAmountCents: 0,
    currency: "MRU",
    notes: input.notes ?? "",
    isLocked: true,
    userId: currentUserId(),
    clientUuid: invoiceId,
    isActive: true,
    version: 0,
    createdAt: now,
    updatedAt: now,
    lines: input.lines.map((line, index) => ({
      id: newUuid(),
      invoiceId,
      productId: line.productId ?? null,
      variantId: null,
      serviceId: line.serviceId ?? null,
      description: line.name,
      productSku: line.sku,
      quantity: String(line.quantity),
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp,
      totalCents: priced.lines[index].totalCents,
      position: index + 1,
    })),
  };

  const rows: RowWrite[] = [{ entity: "sales_invoices", id: invoiceId, version: 0, data: invoice }];
  const queue: QueueEntryInput[] = [
    {
      id: invoiceId,
      entity: "invoicing.sales_invoice",
      localTable: "sales_invoices",
      entityId: invoiceId,
      operation: "CREATE",
      payload: {
        partyId: partyRef.id,
        partyClientUuid: partyRef.clientUuid,
        posSessionId: sessionRef.id,
        posSessionClientUuid: sessionRef.clientUuid,
        source: "POS",
        date,
        globalDiscountBp: input.globalDiscountBp ?? 0,
        notes: input.notes ?? "",
        provisionalNumber: number,
        lines: syncLines,
      },
      dependsOn: [...sessionRef.dependsOn, ...partyRef.dependsOn],
      userId: currentUserId(),
      label: i18n.t("pos:outbox.ticket", { number }),
    },
  ];

  let cashCents = 0;
  for (const payment of input.payments) {
    const paymentId = newUuid();
    if (payment.method === "CASH") cashCents += payment.amountCents;
    rows.push({
      entity: "payments",
      id: paymentId,
      version: 0,
      data: {
        id: paymentId,
        companyId: companyId(),
        number,
        direction: "IN",
        partyId: input.partyId ?? null,
        invoiceId,
        supplierInvoiceId: null,
        bankAccountId:
          payment.bankAccountId ??
          (payment.method === "CASH" ? ((register?.data.cashAccountId as string) ?? null) : null),
        amountCents: payment.amountCents,
        paymentDate: date,
        paymentMethod: payment.method,
        reference: payment.reference ?? number,
        status: "CONFIRMED",
        currency: "MRU",
        notes: "",
        posSessionId: input.sessionId,
        userId: currentUserId(),
        clientUuid: paymentId,
        isActive: true,
        version: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    queue.push({
      id: paymentId,
      entity: "payments.payment",
      localTable: "payments",
      entityId: paymentId,
      operation: "CREATE",
      payload: {
        partyId: partyRef.id,
        partyClientUuid: partyRef.clientUuid,
        invoiceClientUuid: invoiceId,
        posSessionId: sessionRef.id,
        posSessionClientUuid: sessionRef.clientUuid,
        bankAccountId: payment.bankAccountId ?? null,
        amountCents: payment.amountCents,
        paymentDate: date,
        paymentMethod: payment.method,
        reference: payment.reference ?? number,
        notes: "",
      },
      // The ticket first, whatever the order the batch is split in.
      dependsOn: [invoiceId, ...sessionRef.dependsOn, ...partyRef.dependsOn],
      userId: currentUserId(),
      label: i18n.t("pos:outbox.payment", { number }),
    });
  }

  rows.push(...(await stockAfterSale(warehouseId, input.lines)));
  const totals = await sessionTotals(input.sessionId);
  rows.push({
    entity: "pos_sessions",
    id: input.sessionId,
    derived: true,
    data: {
      ...session.data,
      totalSalesCents: totals.totalCents + paidCents,
      totalCashCents: totals.cashCents + cashCents,
      expectedBalanceCents: Number(session.data.openingBalanceCents) + totals.cashCents + cashCents,
      ticketCount: Number(session.data.ticketCount ?? 0) + 1,
    },
  });

  await localDb.write({ rows, queue });
  return { number, totalCents: priced.totalCents, invoiceId };
}

/** Stock left in the till's warehouse after the sale, for the lines already stocked there. */
async function stockAfterSale(
  warehouseId: string | null,
  lines: LocalSaleLine[]
): Promise<RowWrite[]> {
  if (!warehouseId) return [];
  const sold = new Map<string, number>();
  for (const line of lines) {
    if (line.productId) sold.set(line.productId, (sold.get(line.productId) ?? 0) + line.quantity);
  }
  if (sold.size === 0) return [];
  const { rows } = await localDb.query<Row>({
    entity: "stock_items",
    filters: [
      { column: "warehouse_id", op: "eq", value: warehouseId },
      { column: "product_id", op: "in", value: [...sold.keys()] },
    ],
  });
  const seen = new Set<string>();
  return rows.flatMap(({ id, data }) => {
    const productId = String(data.productId);
    // One line per product: the lot-less one, as the server's sale does.
    if (seen.has(productId) || (data.lotNumber ?? "") !== "") return [];
    seen.add(productId);
    const left = normalizeQuantity(Number(data.quantity) - (sold.get(productId) ?? 0));
    return [
      {
        entity: "stock_items" as const,
        id,
        derived: true,
        data: { ...data, quantity: left.toFixed(3) },
      },
    ];
  });
}
