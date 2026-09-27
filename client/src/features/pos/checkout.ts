/**
 * Ticket checkout, online **or** offline.
 *
 * This is where offline mode becomes concrete: the same user action produces either an
 * API call or two outbox operations linked together by their `clientUuid` (invoice then
 * payment). At ingestion the server replays exactly the same business chain, including
 * the stock decrement and the accounting entry
 * ([FR-POS-3], [FR-SYNC-2], `SYNC_STRATEGY.md` §3).
 */

import type { PaymentMethod } from "@shared/schema";
import { formatProvisionalNumber } from "@shared/numbering-helpers";
import { computeDocumentTotals } from "@shared/pricing";
import { todayInput } from "@shared/format";
import { i18n } from "@/shared/i18n";
import { posApi } from "@/entities/pos/api";
import { isNetworkError } from "@/shared/offline/offline-writes";
import { offlineDb } from "@/shared/offline/db";
import { enqueue, newUuid } from "@/shared/offline/outbox";
import { readSnapshot, writeSnapshot } from "@/shared/offline/snapshot";
import { refreshCounters, runSync } from "@/shared/offline/sync-engine";

export interface CartLine {
  /** Set for a catalog product, `null` for a service line. */
  productId: string | null;
  /** Set for a billable service (no stock); absent on product lines. */
  serviceId?: string | null;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  discountBp: number;
}

export interface TicketPayment {
  method: PaymentMethod;
  amountCents: number;
  reference?: string;
  /** Cash, bank or phone payment account chosen by the cashier; `null` = register cash. */
  bankAccountId?: string | null;
}

export interface CheckoutInput {
  sessionId: string;
  /** Session `clientUuid` when it was opened offline. */
  sessionClientUuid?: string | null;
  partyId?: string | null;
  lines: CartLine[];
  payments: TicketPayment[];
  globalDiscountBp?: number;
  notes?: string;
  /** Local provisional number, incremented per register. */
  localTicketSeq: number;
}

export interface CheckoutResult {
  mode: "online" | "offline";
  /** Final number (online) or provisional number (offline). */
  number: string;
  totalCents: number;
  invoiceId?: string;
}

/** Stable identity of a cart line: a product and a service may share an id space. */
export function cartLineKey(line: Pick<CartLine, "productId" | "serviceId">): string {
  return line.serviceId ? `service:${line.serviceId}` : `product:${line.productId}`;
}

/** Cart totals — same function as the server, so no discrepancy is possible. */
export function cartTotals(lines: CartLine[], options: { globalDiscountBp?: number } = {}) {
  return computeDocumentTotals(
    lines.map((line) => ({
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp,
    })),
    { globalDiscountBp: options.globalDiscountBp }
  );
}

function toSyncLines(lines: CartLine[]) {
  return lines.map((line) => ({
    productId: line.productId ?? null,
    serviceId: line.serviceId ?? null,
    description: line.name,
    productSku: line.sku,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
    discountBp: line.discountBp,
  }));
}

/**
 * Checks out online. Every error is propagated: the caller decides whether to fall back
 * to offline mode or to display the rejection (insufficient stock, closed session…).
 */
async function checkoutOnline(input: CheckoutInput): Promise<CheckoutResult> {
  const response = await posApi.createTicket({
    sessionId: input.sessionId,
    partyId: input.partyId ?? null,
    date: todayInput(),
    globalDiscountBp: input.globalDiscountBp ?? 0,
    notes: input.notes ?? "",
    lines: toSyncLines(input.lines),
    payments: input.payments.map((payment) => ({
      method: payment.method,
      amountCents: payment.amountCents,
      reference: payment.reference,
      bankAccountId: payment.bankAccountId ?? null,
    })),
  });
  return {
    mode: "online",
    number: response.invoice.number,
    totalCents: response.invoice.totalCents,
    invoiceId: response.invoice.id,
  };
}

/**
 * Checks out offline: the invoice and its payments go to the outbox.
 * Payments declare the invoice as a dependency, which guarantees the replay order
 * even if the batch is split or replayed several times.
 */
async function checkoutOffline(input: CheckoutInput): Promise<CheckoutResult> {
  const totals = cartTotals(input.lines, {
    globalDiscountBp: input.globalDiscountBp,
  });
  const provisionalNumber = formatProvisionalNumber("TKT", input.localTicketSeq);
  const invoiceClientUuid = newUuid();

  await enqueue({
    clientUuid: invoiceClientUuid,
    entity: "invoicing.sales_invoice",
    label: i18n.t("pos:outbox.ticket", { number: provisionalNumber }),
    amountCents: totals.totalCents,
    provisionalNumber,
    payload: {
      partyId: input.partyId ?? null,
      posSessionId: input.sessionClientUuid ? null : input.sessionId,
      posSessionClientUuid: input.sessionClientUuid ?? null,
      source: "POS",
      date: todayInput(),
      globalDiscountBp: input.globalDiscountBp ?? 0,
      notes: input.notes ?? "",
      provisionalNumber,
      lines: toSyncLines(input.lines),
    },
    dependsOn: input.sessionClientUuid ? [input.sessionClientUuid] : [],
  });

  for (const payment of input.payments) {
    await enqueue({
      entity: "payments.payment",
      label: i18n.t("pos:outbox.payment", { number: provisionalNumber }),
      amountCents: payment.amountCents,
      payload: {
        partyId: input.partyId ?? null,
        invoiceClientUuid,
        posSessionId: input.sessionClientUuid ? null : input.sessionId,
        posSessionClientUuid: input.sessionClientUuid ?? null,
        bankAccountId: payment.bankAccountId ?? null,
        amountCents: payment.amountCents,
        paymentDate: todayInput(),
        paymentMethod: payment.method,
        reference: payment.reference ?? provisionalNumber,
        notes: "",
      },
      dependsOn: [invoiceClientUuid],
    });
  }

  await refreshCounters();
  return { mode: "offline", number: provisionalNumber, totalCents: totals.totalCents };
}

/**
 * Checks out the ticket.
 *
 * Online first; if the server is unreachable, automatically falls back to offline mode.
 * A **business** error (insufficient stock, inconsistent amount) is never turned into
 * an offline write: it would be rejected the same way at ingestion, and the sale would
 * stay stuck in the queue without the cashier knowing.
 */
export async function checkout(
  input: CheckoutInput,
  options: { online: boolean }
): Promise<CheckoutResult> {
  if (!options.online) return checkoutOffline(input);

  try {
    const result = await checkoutOnline(input);
    void runSync();
    return result;
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return checkoutOffline(input);
  }
}

/** Opens a register session, online or offline. */
export async function openSession(
  input: { registerId: string; openingBalanceCents: number; notes?: string },
  options: { online: boolean }
): Promise<{ mode: "online" | "offline"; sessionId: string; clientUuid: string | null }> {
  if (options.online) {
    try {
      const session = await posApi.openSession({
        registerId: input.registerId,
        openingBalanceCents: input.openingBalanceCents,
        notes: input.notes ?? "",
      });
      return { mode: "online", sessionId: session.id, clientUuid: null };
    } catch (error) {
      // Network lost while sending: the opening goes to the queue, as when offline.
      if (!isNetworkError(error)) throw error;
    }
  }

  const clientUuid = newUuid();
  await enqueue({
    clientUuid,
    entity: "pos.session_open",
    label: i18n.t("pos:outbox.sessionOpen"),
    amountCents: input.openingBalanceCents,
    payload: {
      registerId: input.registerId,
      openingBalanceCents: input.openingBalanceCents,
      openedAt: new Date().toISOString(),
      notes: input.notes ?? "",
    },
  });
  await refreshCounters();
  // Offline, the session id is the `clientUuid`: the server will replace it with the
  // final id at ingestion time.
  return { mode: "offline", sessionId: clientUuid, clientUuid };
}

/** Closes a register session, online or offline. */
export async function closeSession(
  input: {
    sessionId: string;
    sessionClientUuid?: string | null;
    closingBalanceCents: number;
    notes?: string;
  },
  options: { online: boolean }
): Promise<{ mode: "online" | "offline"; differenceCents: number | null }> {
  if (options.online && !input.sessionClientUuid) {
    try {
      const session = await posApi.closeSession(input.sessionId, {
        closingBalanceCents: input.closingBalanceCents,
        notes: input.notes,
      });
      return { mode: "online", differenceCents: session.differenceCents };
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }

  await enqueue({
    entity: "pos.session_close",
    label: i18n.t("pos:outbox.sessionClose"),
    amountCents: input.closingBalanceCents,
    payload: {
      sessionId: input.sessionClientUuid ? null : input.sessionId,
      sessionClientUuid: input.sessionClientUuid ?? null,
      closingBalanceCents: input.closingBalanceCents,
      closedAt: new Date().toISOString(),
      notes: input.notes ?? "",
    },
    dependsOn: input.sessionClientUuid ? [input.sessionClientUuid] : [],
  });
  // Offline, the current session is read from the snapshot: it must appear closed
  // there, otherwise the register would immediately reopen it.
  const snapshot = await readSnapshot();
  if (snapshot?.session && snapshot.session.id === input.sessionId) {
    await writeSnapshot({ ...snapshot, session: null });
  }
  await refreshCounters();
  // The difference is only known once the server recomputes the session's receipts.
  return { mode: "offline", differenceCents: null };
}

/**
 * Payments of a register session still waiting on this device (sales made without
 * internet, not yet received by the server). The server's session summary does not
 * know them: without them the expected cash would be wrong and show a false gap.
 */
export async function pendingSessionTotals(session: {
  sessionId: string;
  clientUuid: string | null;
}): Promise<{ cashCents: number; totalCents: number }> {
  const waiting = await offlineDb.outbox.filter((record) => record.status !== "synced").toArray();
  // A session opened without internet and sent since: its sales may still point to
  // its provisional identifier.
  const sessionClientUuids = new Set<string>(session.clientUuid ? [session.clientUuid] : []);
  const opened = await offlineDb.outbox
    .where("entity")
    .equals("pos.session_open")
    .filter((record) => record.serverId === session.sessionId)
    .toArray();
  for (const record of opened) sessionClientUuids.add(record.clientUuid);

  let cashCents = 0;
  let totalCents = 0;
  for (const record of waiting) {
    if (record.entity !== "payments.payment") continue;
    const payload = record.payload as {
      posSessionId?: string | null;
      posSessionClientUuid?: string | null;
      paymentMethod?: string;
      amountCents?: number;
    };
    const belongs =
      payload.posSessionId === session.sessionId ||
      (!!payload.posSessionClientUuid && sessionClientUuids.has(payload.posSessionClientUuid));
    if (!belongs) continue;
    const amount = Number(payload.amountCents) || 0;
    totalCents += amount;
    if (payload.paymentMethod === "CASH") cashCents += amount;
  }
  return { cashCents, totalCents };
}
