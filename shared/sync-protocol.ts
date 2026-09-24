/**
 * Online/Offline synchronization contract — shared between client and server.
 *
 * Three endpoints, no more (`SYNC_STRATEGY.md` §2):
 *  - `GET  /api/sync/snapshot` — full snapshot used to bootstrap the local cache;
 *  - `GET  /api/sync/pull?since=` — delta since a cursor (changes from other devices);
 *  - `POST /api/sync/push` — **idempotent** ingestion of the outbox, in causal order.
 *
 * Principles applied here:
 *  - the client emits **intents** identified by `clientUuid`; the server is the
 *    authority on legal numbers, consolidated stock and accounting entries ([BR-8]);
 *  - a replayed operation returns `duplicate` + the already-created id, **without writing**;
 *  - a dependency not yet resolved returns `deferred`: the client replays on the next
 *    cycle instead of failing permanently (`SYNC_STRATEGY.md` §4).
 */

import { z } from "zod";

/** Entities accepted for offline writes, prefixed by domain. */
export const SYNC_ENTITIES = [
  "core.party",
  "catalog.product",
  "sales.quote",
  "invoicing.sales_invoice",
  "payments.payment",
  "pos.session_open",
  "pos.session_close",
  "inventory.stock_movement",
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const syncEntitySchema = z.enum(SYNC_ENTITIES);

export const SYNC_OPERATION_STATUSES = ["created", "duplicate", "error", "deferred"] as const;
export type SyncOperationStatus = (typeof SYNC_OPERATION_STATUSES)[number];

/** Document line carried by an offline operation. */
export const syncDocumentLineSchema = z.object({
  productId: z.string().uuid().nullish(),
  /** Product itself created offline: resolved via the batch's `catalog.product` operation. */
  productClientUuid: z.string().uuid().nullish(),
  variantId: z.string().uuid().nullish(),
  serviceId: z.string().uuid().nullish(),
  description: z.string().min(1),
  productSku: z.string().default(""),
  quantity: z.union([z.number(), z.string()]),
  unit: z.string().default("unité"),
  unitPriceCents: z.number().int(),
  discountBp: z.number().int().min(0).max(10_000).default(0),
  vatRateBp: z.number().int().min(0).max(10_000).default(0),
  originCountry: z.string().default(""),
});
export type SyncDocumentLine = z.infer<typeof syncDocumentLineSchema>;

export const syncPartyPayloadSchema = z.object({
  name: z.string().min(1),
  partyType: z.enum(["CUSTOMER", "SUPPLIER", "BOTH", "PROSPECT"]).default("CUSTOMER"),
  email: z.string().default(""),
  phone: z.string().default(""),
  vatNumber: z.string().default(""),
  creditLimitCents: z.number().int().min(0).default(0),
  paymentTermsDays: z.number().int().min(0).default(0),
  notes: z.string().default(""),
});

export const syncProductPayloadSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  unit: z.string().default("unité"),
  barcode: z.string().default(""),
  salePriceCents: z.number().int().default(0),
  purchasePriceCents: z.number().int().default(0),
  vatRateBp: z.number().int().default(0),
  isService: z.boolean().default(false),
  categoryId: z.string().uuid().nullish(),
  minStock: z.union([z.number(), z.string()]).default("0"),
  initialStock: z
    .object({
      warehouseId: z.string().uuid(),
      quantity: z.union([z.number(), z.string()]),
      unitCostCents: z.number().int().min(0).default(0),
    })
    .nullish(),
});

export const syncInvoicePayloadSchema = z.object({
  partyId: z.string().uuid().nullish(),
  /** Customer created in the same offline batch. */
  partyClientUuid: z.string().uuid().nullish(),
  warehouseId: z.string().uuid().nullish(),
  posSessionId: z.string().uuid().nullish(),
  posSessionClientUuid: z.string().uuid().nullish(),
  source: z.enum(["MANUAL", "ORDER", "POS"]).default("POS"),
  date: z.string(),
  dueDate: z.string().nullish(),
  globalDiscountBp: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().default(""),
  /** Provisional number shown offline; replaced by the final number on ACK. */
  provisionalNumber: z.string().default(""),
  lines: z.array(syncDocumentLineSchema).min(1),
});

export const syncQuotePayloadSchema = z.object({
  partyId: z.string().uuid().nullish(),
  partyClientUuid: z.string().uuid().nullish(),
  date: z.string(),
  expiryDate: z.string().nullish(),
  globalDiscountBp: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().default(""),
  provisionalNumber: z.string().default(""),
  lines: z.array(syncDocumentLineSchema).min(1),
});

export const syncPaymentPayloadSchema = z.object({
  partyId: z.string().uuid().nullish(),
  partyClientUuid: z.string().uuid().nullish(),
  invoiceId: z.string().uuid().nullish(),
  invoiceClientUuid: z.string().uuid().nullish(),
  bankAccountId: z.string().uuid().nullish(),
  posSessionId: z.string().uuid().nullish(),
  posSessionClientUuid: z.string().uuid().nullish(),
  amountCents: z.number().int().positive(),
  paymentDate: z.string(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CHECK", "CARD", "MOBILE_MONEY"]).default("CASH"),
  reference: z.string().default(""),
  notes: z.string().default(""),
});

export const syncSessionOpenPayloadSchema = z.object({
  registerId: z.string().uuid(),
  openingBalanceCents: z.number().int().default(0),
  openedAt: z.string(),
  notes: z.string().default(""),
});

export const syncSessionClosePayloadSchema = z.object({
  sessionId: z.string().uuid().nullish(),
  sessionClientUuid: z.string().uuid().nullish(),
  closingBalanceCents: z.number().int().default(0),
  closedAt: z.string(),
  notes: z.string().default(""),
});

export const syncStockMovementPayloadSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  movementType: z.enum(["IN", "OUT", "ADJUSTMENT", "RETURN"]),
  /** Explicit direction of an adjustment; otherwise inferred from the movement type. */
  direction: z.enum(["IN", "OUT"]).nullish(),
  quantity: z.union([z.number(), z.string()]),
  unitCostCents: z.number().int().min(0).nullish(),
  reason: z.string().default(""),
  lotNumber: z.string().default(""),
});

/** Single outbox operation. */
export const syncOperationSchema = z.object({
  /** Idempotency key generated on the device (UUIDv4). */
  clientUuid: z.string().uuid(),
  /** Monotonic local counter: guarantees the causal replay order (`SYNC_STRATEGY.md` §4). */
  localSeq: z.number().int().nonnegative(),
  entity: syncEntitySchema,
  action: z.enum(["create", "update"]).default("create"),
  /** `clientUuid`s of the operations this one depends on; otherwise `deferred`. */
  dependsOn: z.array(z.string().uuid()).default([]),
  createdAt: z.string(),
  payload: z.record(z.unknown()),
});
export type SyncOperationInput = z.infer<typeof syncOperationSchema>;

export const syncPushRequestSchema = z.object({
  deviceId: z.string().min(1).max(128),
  /** Beyond this, the client splits: a batch must stay processable in a single HTTP request. */
  operations: z.array(syncOperationSchema).max(200),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export interface SyncOperationResult {
  clientUuid: string;
  entity: SyncEntity;
  status: SyncOperationStatus;
  /** Server id created (or existing, for a `duplicate`). */
  serverId?: string;
  /** Final legal number assigned — replaces the provisional number on the client. */
  assignedNumber?: string;
  /** Human-readable error message (in the request language), present when `status` is `error` or `deferred`. */
  detail?: string;
}

export interface SyncPushResponse {
  results: SyncOperationResult[];
  /** Cursor to pass to the next `pull`. */
  cursor: string;
  serverTime: string;
}

/** Maps each entity to its payload schema. */
export const SYNC_PAYLOAD_SCHEMAS = {
  "core.party": syncPartyPayloadSchema,
  "catalog.product": syncProductPayloadSchema,
  "sales.quote": syncQuotePayloadSchema,
  "invoicing.sales_invoice": syncInvoicePayloadSchema,
  "payments.payment": syncPaymentPayloadSchema,
  "pos.session_open": syncSessionOpenPayloadSchema,
  "pos.session_close": syncSessionClosePayloadSchema,
  "inventory.stock_movement": syncStockMovementPayloadSchema,
} as const satisfies Record<SyncEntity, z.ZodTypeAny>;

/** Recommended replay order when two operations share the same `localSeq`. */
export const SYNC_ENTITY_PRIORITY: Record<SyncEntity, number> = {
  "core.party": 10,
  "catalog.product": 10,
  "pos.session_open": 20,
  "sales.quote": 30,
  "invoicing.sales_invoice": 40,
  "payments.payment": 50,
  "inventory.stock_movement": 60,
  "pos.session_close": 90,
};

/** Canonical batch ordering: `localSeq` first, entity priority as tie-breaker. */
export function sortOperations<T extends { localSeq: number; entity: SyncEntity }>(
  operations: T[]
): T[] {
  return [...operations].sort(
    (a, b) =>
      a.localSeq - b.localSeq || SYNC_ENTITY_PRIORITY[a.entity] - SYNC_ENTITY_PRIORITY[b.entity]
  );
}
