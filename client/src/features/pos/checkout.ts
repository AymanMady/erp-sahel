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
import { enqueue, newUuid } from "@/shared/offline/outbox";
import { readSnapshot, writeSnapshot } from "@/shared/offline/snapshot";
import { refreshCounters, runSync } from "@/shared/offline/sync-engine";

export interface CartLine {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  vatRateBp: number;
  discountBp: number;
  originCountry?: string;
}

export interface TicketPayment {
  method: PaymentMethod;
  amountCents: number;
  reference?: string;
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
  vatEnabled: boolean;
  /** Local provisional number, incremented per register. */
  localTicketSeq: number;
}

export interface CheckoutResult {
  mode: "online" | "offline";
  /** Final number (online) or provisional number (offline). */
  number: string;
  totalTtcCents: number;
  invoiceId?: string;
}

/** Cart totals — same function as the server, so no discrepancy is possible. */
export function cartTotals(
  lines: CartLine[],
  options: { globalDiscountBp?: number; vatEnabled: boolean }
) {
  return computeDocumentTotals(
    lines.map((line) => ({
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp,
      vatRateBp: line.vatRateBp,
    })),
    { globalDiscountBp: options.globalDiscountBp, vatEnabled: options.vatEnabled }
  );
}

function toSyncLines(lines: CartLine[]) {
  return lines.map((line) => ({
    productId: line.productId,
    description: line.name,
    productSku: line.sku,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
    discountBp: line.discountBp,
    vatRateBp: line.vatRateBp,
    originCountry: line.originCountry ?? "",
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
    })),
  });
  return {
    mode: "online",
    number: response.invoice.number,
    totalTtcCents: response.invoice.totalTtcCents,
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
    vatEnabled: input.vatEnabled,
  });
  const provisionalNumber = formatProvisionalNumber("TKT", input.localTicketSeq);
  const invoiceClientUuid = newUuid();

  await enqueue({
    clientUuid: invoiceClientUuid,
    entity: "invoicing.sales_invoice",
    label: i18n.t("pos:outbox.ticket", { number: provisionalNumber }),
    amountCents: totals.totalTtcCents,
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
  return { mode: "offline", number: provisionalNumber, totalTtcCents: totals.totalTtcCents };
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
