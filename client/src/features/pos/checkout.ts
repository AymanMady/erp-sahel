/**
 * Encaissement d'un ticket, en ligne **ou** hors ligne.
 *
 * C'est le point où le mode hors ligne devient concret : la même action utilisateur
 * produit soit un appel API, soit deux opérations d'outbox liées entre elles par leurs
 * `clientUuid` (facture puis règlement). Le serveur rejouera exactement la même chaîne
 * métier à l'ingestion, y compris le décrément de stock et l'écriture comptable
 * ([FR-POS-3], [FR-SYNC-2], `SYNC_STRATEGY.md` §3).
 */

import type { PaymentMethod } from "@shared/schema";
import { formatProvisionalNumber } from "@shared/numbering-helpers";
import { computeDocumentTotals } from "@shared/pricing";
import { todayInput } from "@shared/format";
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
  /** `clientUuid` de la session si elle a été ouverte hors ligne. */
  sessionClientUuid?: string | null;
  partyId?: string | null;
  lines: CartLine[];
  payments: TicketPayment[];
  globalDiscountBp?: number;
  notes?: string;
  vatEnabled: boolean;
  /** Numéro provisoire local, incrémenté par poste. */
  localTicketSeq: number;
}

export interface CheckoutResult {
  mode: "online" | "offline";
  /** Numéro définitif (en ligne) ou provisoire (hors ligne). */
  number: string;
  totalTtcCents: number;
  invoiceId?: string;
}

/** Totaux du panier — même fonction que le serveur, donc aucun écart possible. */
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
 * Encaisse en ligne. Toute erreur est propagée : l'appelant décidera de basculer
 * hors ligne ou d'afficher le refus (stock insuffisant, session close…).
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
 * Encaisse hors ligne : la facture et ses règlements partent dans l'outbox.
 * Les règlements déclarent la facture en dépendance, ce qui garantit l'ordre de rejeu
 * même si le lot est découpé ou rejoué plusieurs fois.
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
    label: `Ticket ${provisionalNumber}`,
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
      label: `Règlement ${provisionalNumber}`,
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
 * Encaisse le ticket.
 *
 * En ligne d'abord ; si le serveur est injoignable, bascule automatiquement hors ligne.
 * Une erreur **métier** (stock insuffisant, montant incohérent) n'est jamais convertie
 * en écriture hors ligne : elle serait rejetée de la même façon à l'ingestion, et la
 * vente resterait bloquée dans la file sans que le caissier le sache.
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

/** Ouvre une session de caisse, en ligne ou hors ligne. */
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
      // Réseau perdu pendant l'envoi : l'ouverture part dans la file, comme hors ligne.
      if (!isNetworkError(error)) throw error;
    }
  }

  const clientUuid = newUuid();
  await enqueue({
    clientUuid,
    entity: "pos.session_open",
    label: "Ouverture de caisse",
    amountCents: input.openingBalanceCents,
    payload: {
      registerId: input.registerId,
      openingBalanceCents: input.openingBalanceCents,
      openedAt: new Date().toISOString(),
      notes: input.notes ?? "",
    },
  });
  await refreshCounters();
  // Hors ligne, l'identifiant de session est le `clientUuid` : le serveur le
  // remplacera par l'identifiant définitif au moment de l'ingestion.
  return { mode: "offline", sessionId: clientUuid, clientUuid };
}

/** Clôture une session de caisse, en ligne ou hors ligne. */
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
    label: "Clôture de caisse",
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
  // Hors ligne, la session courante est lue dans l'instantané : elle doit y apparaître
  // close, sinon la caisse la rouvrirait aussitôt.
  const snapshot = await readSnapshot();
  if (snapshot?.session && snapshot.session.id === input.sessionId) {
    await writeSnapshot({ ...snapshot, session: null });
  }
  await refreshCounters();
  // L'écart n'est connu qu'après recalcul serveur des encaissements de la session.
  return { mode: "offline", differenceCents: null };
}
