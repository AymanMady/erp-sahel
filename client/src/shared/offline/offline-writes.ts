/**
 * **Offline** writes of the management forms (parties, products, quotes, invoices,
 * payments, stock movements).
 *
 * Same principle as the POS checkout (`features/pos/checkout.ts`): the form tries the
 * API call; if the server is unreachable, the intent goes to the outbox and will be
 * replayed at synchronization ([FR-SYNC-2]). A **business** error is never queued: it
 * would be rejected the same way at ingestion.
 *
 * A party or product created offline can be used right away in a quote or invoice: its
 * `clientUuid` acts as the identifier, and the dependent operation passes it as
 * `xxxClientUuid` + `dependsOn` so that the server resolves it.
 *
 * Unit values such as `"unité"` are the database default, not UI text.
 */

import type { Party, Product } from "@shared/schema";
import { formatProvisionalNumber } from "@shared/numbering-helpers";
import { computeDocumentTotals } from "@shared/pricing";
import { ApiError } from "@/shared/api/api-error";
import { i18n } from "@/shared/i18n";
import { offlineDb, type OutboxRecord } from "./db";
import { enqueue, newUuid } from "./outbox";
import { readMeta, writeMeta } from "./storage";
import { refreshCounters } from "./sync-engine";

const DOC_SEQ_KEY = "offline.localDocSeq";

/** True if the error means "server unreachable" (and not a business rejection). */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.isNetworkError;
}

/**
 * Runs the online call; if it fails for lack of network, runs the queueing instead.
 * `mode` lets the form adapt its message and navigation.
 */
export async function onlineOrQueued<TOnline, TQueued>(
  online: () => Promise<TOnline>,
  queued: () => Promise<TQueued>
): Promise<{ mode: "online"; result: TOnline } | { mode: "offline"; result: TQueued }> {
  try {
    return { mode: "online", result: await online() };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const result = await queued();
    await refreshCounters();
    return { mode: "offline", result };
  }
}

async function nextProvisionalNumber(prefix: string): Promise<string> {
  const current = Number.parseInt((await readMeta(DOC_SEQ_KEY)) ?? "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  await writeMeta(DOC_SEQ_KEY, String(next));
  return formatProvisionalNumber(prefix, next);
}

/** Operations of an entity still waiting for synchronization. */
export async function pendingRecords(entity: OutboxRecord["entity"]): Promise<OutboxRecord[]> {
  try {
    const rows = await offlineDb.outbox.where("entity").equals(entity).toArray();
    return rows.filter((row) => row.status !== "synced");
  } catch {
    return [];
  }
}

/**
 * Turns a displayed identifier into a protocol reference: server identifier, or
 * `clientUuid` of an offline creation not yet synchronized.
 */
async function resolveRef(id: string | null | undefined): Promise<{
  id: string | null;
  clientUuid: string | null;
}> {
  if (!id) return { id: null, clientUuid: null };
  try {
    const record = await offlineDb.outbox.get(id);
    if (!record) return { id, clientUuid: null };
    if (record.serverId) return { id: record.serverId, clientUuid: null };
    return { id: null, clientUuid: id };
  } catch {
    return { id, clientUuid: null };
  }
}

function dependencies(...refs: { clientUuid: string | null }[]): string[] {
  return [...new Set(refs.map((ref) => ref.clientUuid).filter((id): id is string => !!id))];
}

// ─── Display of pending creations ─────────────────────────────────────────────

/** Code shown for a record the server has not numbered yet. */
function pendingCode(): string {
  return i18n.t("offline:write.pendingNumber");
}

/** Parties created offline, as a displayable and selectable `Party`. */
export async function pendingParties(): Promise<Party[]> {
  const records = await pendingRecords("core.party");
  return records.map((record) => {
    const payload = record.payload as Partial<Party>;
    return {
      id: record.clientUuid,
      companyId: "",
      code: pendingCode(),
      name: String(payload.name ?? ""),
      partyType: payload.partyType ?? "CUSTOMER",
      email: payload.email ?? "",
      phone: payload.phone ?? "",
      vatNumber: payload.vatNumber ?? "",
      creditLimitCents: payload.creditLimitCents ?? 0,
      paymentTermsDays: payload.paymentTermsDays ?? 0,
      notes: payload.notes ?? "",
      isActive: true,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    } as unknown as Party;
  });
}

/** Products created offline, as a displayable `Product`. */
export async function pendingProducts(): Promise<Product[]> {
  const records = await pendingRecords("catalog.product");
  return records.map(
    (record) =>
      ({
        ...record.payload,
        id: record.clientUuid,
        companyId: "",
        profileType: record.payload.profileType ?? "GENERIC",
        minStock: String(record.payload.minStock ?? "0"),
        isActive: true,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }) as unknown as Product
  );
}

// ─── Queueing ─────────────────────────────────────────────────────────────────

export async function queuePartyCreate(input: {
  name: string;
  partyType: string;
  email?: string;
  phone?: string;
  vatNumber?: string;
  creditLimitCents?: number;
  paymentTermsDays?: number;
  notes?: string;
}): Promise<{ id: string; name: string; code: string }> {
  const record = await enqueue({
    entity: "core.party",
    label: i18n.t("offline:outboxLabels.party", { name: input.name }),
    payload: {
      name: input.name,
      partyType: input.partyType,
      email: input.email ?? "",
      phone: input.phone ?? "",
      vatNumber: input.vatNumber ?? "",
      creditLimitCents: input.creditLimitCents ?? 0,
      paymentTermsDays: input.paymentTermsDays ?? 0,
      notes: input.notes ?? "",
    },
  });
  return { id: record.clientUuid, name: input.name, code: pendingCode() };
}

export async function queueProductCreate(input: {
  sku: string;
  name: string;
  description?: string;
  unit?: string;
  barcode?: string;
  salePriceCents?: number;
  purchasePriceCents?: number;
  vatRateBp?: number;
  isService?: boolean;
  categoryId?: string | null;
  minStock?: string | number;
  profileType?: string;
  profile?: Record<string, unknown> | null;
  initialStock?: { warehouseId: string; quantity: string | number; unitCostCents: number } | null;
}): Promise<{ id: string; name: string }> {
  const record = await enqueue({
    entity: "catalog.product",
    label: i18n.t("offline:outboxLabels.product", { sku: input.sku, name: input.name }),
    payload: {
      sku: input.sku,
      name: input.name,
      description: input.description ?? "",
      unit: input.unit ?? "unité",
      barcode: input.barcode ?? "",
      salePriceCents: input.salePriceCents ?? 0,
      purchasePriceCents: input.purchasePriceCents ?? 0,
      vatRateBp: input.vatRateBp ?? 0,
      isService: input.isService ?? false,
      categoryId: input.categoryId ?? null,
      minStock: String(input.minStock ?? "0"),
      profileType: input.profileType ?? "GENERIC",
      profile: input.profile ?? null,
      initialStock: input.initialStock ?? null,
    },
  });
  return { id: record.clientUuid, name: input.name };
}

export interface OfflineDocumentLine {
  productId?: string | null;
  serviceId?: string | null;
  productSku?: string;
  description: string;
  quantity: number | string;
  unit?: string;
  unitPriceCents: number;
  discountBp?: number;
  vatRateBp?: number;
}

async function toSyncLines(lines: OfflineDocumentLine[]) {
  const refs: { clientUuid: string | null }[] = [];
  const mapped = [];
  for (const line of lines) {
    const product = await resolveRef(line.productId);
    refs.push(product);
    mapped.push({
      productId: product.id,
      productClientUuid: product.clientUuid,
      serviceId: line.serviceId ?? null,
      productSku: line.productSku ?? "",
      description: line.description,
      quantity: line.quantity,
      unit: line.unit ?? "unité",
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp ?? 0,
      vatRateBp: line.vatRateBp ?? 0,
    });
  }
  return { lines: mapped, refs };
}

function totalOf(lines: OfflineDocumentLine[], globalDiscountBp = 0): number {
  return computeDocumentTotals(
    lines.map((line) => ({
      quantity: Number(line.quantity),
      unitPriceCents: line.unitPriceCents,
      discountBp: line.discountBp ?? 0,
      vatRateBp: line.vatRateBp ?? 0,
    })),
    { globalDiscountBp, vatEnabled: true }
  ).totalTtcCents;
}

export async function queueQuoteCreate(input: {
  partyId: string;
  date: string;
  expiryDate?: string | null;
  notes?: string;
  globalDiscountBp?: number;
  lines: OfflineDocumentLine[];
}): Promise<{ provisionalNumber: string }> {
  const party = await resolveRef(input.partyId);
  const { lines, refs } = await toSyncLines(input.lines);
  const provisionalNumber = await nextProvisionalNumber("DEV");
  await enqueue({
    entity: "sales.quote",
    label: i18n.t("offline:outboxLabels.quote", { number: provisionalNumber }),
    amountCents: totalOf(input.lines, input.globalDiscountBp),
    provisionalNumber,
    payload: {
      partyId: party.id,
      partyClientUuid: party.clientUuid,
      date: input.date,
      expiryDate: input.expiryDate ?? null,
      globalDiscountBp: input.globalDiscountBp ?? 0,
      notes: input.notes ?? "",
      provisionalNumber,
      lines,
    },
    dependsOn: dependencies(party, ...refs),
  });
  return { provisionalNumber };
}

/** Offline invoice: always **validated** at ingestion (stock and accounting). */
export async function queueInvoiceCreate(input: {
  partyId: string;
  date: string;
  dueDate?: string | null;
  warehouseId?: string | null;
  notes?: string;
  globalDiscountBp?: number;
  lines: OfflineDocumentLine[];
}): Promise<{ provisionalNumber: string }> {
  const party = await resolveRef(input.partyId);
  const { lines, refs } = await toSyncLines(input.lines);
  const provisionalNumber = await nextProvisionalNumber("FAC");
  await enqueue({
    entity: "invoicing.sales_invoice",
    label: i18n.t("offline:outboxLabels.invoice", { number: provisionalNumber }),
    amountCents: totalOf(input.lines, input.globalDiscountBp),
    provisionalNumber,
    payload: {
      partyId: party.id,
      partyClientUuid: party.clientUuid,
      warehouseId: input.warehouseId ?? null,
      source: "MANUAL",
      date: input.date,
      dueDate: input.dueDate ?? null,
      globalDiscountBp: input.globalDiscountBp ?? 0,
      notes: input.notes ?? "",
      provisionalNumber,
      lines,
    },
    dependsOn: dependencies(party, ...refs),
  });
  return { provisionalNumber };
}

export async function queuePaymentCreate(input: {
  partyId?: string | null;
  invoiceId?: string | null;
  bankAccountId?: string | null;
  amountCents: number;
  paymentDate: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
}): Promise<void> {
  const party = await resolveRef(input.partyId);
  const invoice = await resolveRef(input.invoiceId);
  await enqueue({
    entity: "payments.payment",
    label: i18n.t("offline:outboxLabels.payment", {
      reference: input.reference || input.paymentDate,
    }),
    amountCents: input.amountCents,
    payload: {
      partyId: party.id,
      partyClientUuid: party.clientUuid,
      invoiceId: invoice.id,
      invoiceClientUuid: invoice.clientUuid,
      bankAccountId: input.bankAccountId ?? null,
      amountCents: input.amountCents,
      paymentDate: input.paymentDate,
      paymentMethod: input.paymentMethod,
      reference: input.reference ?? "",
      notes: input.notes ?? "",
    },
    dependsOn: dependencies(party, invoice),
  });
}

export async function queueStockMovement(input: {
  productId: string;
  warehouseId: string;
  direction: "IN" | "OUT";
  quantity: number | string;
  unitCostCents?: number;
  reason?: string;
}): Promise<void> {
  const product = await resolveRef(input.productId);
  if (!product.id) {
    throw new Error(i18n.t("offline:errors.productNotSynced"));
  }
  await enqueue({
    entity: "inventory.stock_movement",
    label: i18n.t("offline:outboxLabels.stockAdjustment", {
      quantity: `${input.direction === "IN" ? "+" : "−"}${input.quantity}`,
    }),
    payload: {
      productId: product.id,
      warehouseId: input.warehouseId,
      movementType: "ADJUSTMENT",
      direction: input.direction,
      quantity: input.quantity,
      unitCostCents: input.unitCostCents ?? null,
      reason: input.reason ?? "",
      lotNumber: "",
    },
  });
}

export { newUuid };
