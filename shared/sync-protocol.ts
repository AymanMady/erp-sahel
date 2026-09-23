/**
 * Contrat de synchronisation Online/Offline — partagé client ⇄ serveur.
 *
 * Trois endpoints, pas un de plus (`SYNC_STRATEGY.md` §2) :
 *  - `GET  /api/sync/snapshot` — instantané complet servant d'amorçage du cache local ;
 *  - `GET  /api/sync/pull?since=` — delta depuis un curseur (changements des autres postes) ;
 *  - `POST /api/sync/push` — ingestion **idempotente** de l'outbox, dans l'ordre causal.
 *
 * Principes appliqués ici :
 *  - le client émet des **intentions** identifiées par `clientUuid` ; le serveur est
 *    autorité sur les numéros légaux, le stock consolidé et les écritures ([BR-8]) ;
 *  - une opération rejouée renvoie `duplicate` + l'identifiant déjà créé, **sans écrire** ;
 *  - une dépendance non encore résolue renvoie `deferred` : le client rejoue au cycle
 *    suivant au lieu d'échouer définitivement (`SYNC_STRATEGY.md` §4).
 */

import { z } from "zod";

/** Entités acceptées en écriture hors-ligne, préfixées par domaine. */
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

/** Ligne de document transportée par une opération hors-ligne. */
export const syncDocumentLineSchema = z.object({
  productId: z.string().uuid().nullish(),
  /** Produit lui-même créé hors-ligne : résolu via l'opération `catalog.product` du lot. */
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
  /** Profil métier (Auto Parts, Vêtements, Marché), validé par le module à l'ingestion. */
  profileType: z.enum(["GENERIC", "AUTO_PARTS", "CLOTHING", "MARKET"]).default("GENERIC"),
  profile: z.record(z.unknown()).nullish(),
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
  /** Client créé dans le même lot hors-ligne. */
  partyClientUuid: z.string().uuid().nullish(),
  warehouseId: z.string().uuid().nullish(),
  posSessionId: z.string().uuid().nullish(),
  posSessionClientUuid: z.string().uuid().nullish(),
  source: z.enum(["MANUAL", "ORDER", "POS"]).default("POS"),
  date: z.string(),
  dueDate: z.string().nullish(),
  globalDiscountBp: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().default(""),
  /** Numéro provisoire affiché hors-ligne ; remplacé par le numéro définitif à l'ACK. */
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
  /** Sens explicite d'un ajustement ; sinon déduit du type de mouvement. */
  direction: z.enum(["IN", "OUT"]).nullish(),
  quantity: z.union([z.number(), z.string()]),
  unitCostCents: z.number().int().min(0).nullish(),
  reason: z.string().default(""),
  lotNumber: z.string().default(""),
});

/** Opération unitaire de l'outbox. */
export const syncOperationSchema = z.object({
  /** Clé d'idempotence générée sur le poste (UUIDv4). */
  clientUuid: z.string().uuid(),
  /** Compteur local monotone : garantit l'ordre causal du rejeu (`SYNC_STRATEGY.md` §4). */
  localSeq: z.number().int().nonnegative(),
  entity: syncEntitySchema,
  action: z.enum(["create", "update"]).default("create"),
  /** `clientUuid` d'opérations dont celle-ci dépend ; sinon `deferred`. */
  dependsOn: z.array(z.string().uuid()).default([]),
  createdAt: z.string(),
  payload: z.record(z.unknown()),
});
export type SyncOperationInput = z.infer<typeof syncOperationSchema>;

export const syncPushRequestSchema = z.object({
  deviceId: z.string().min(1).max(128),
  /** Au-delà, le client découpe : un lot doit rester traitable dans une requête HTTP. */
  operations: z.array(syncOperationSchema).max(200),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export interface SyncOperationResult {
  clientUuid: string;
  entity: SyncEntity;
  status: SyncOperationStatus;
  /** Identifiant serveur créé (ou existant pour un `duplicate`). */
  serverId?: string;
  /** Numéro légal définitif attribué — remplace le numéro provisoire côté client. */
  assignedNumber?: string;
  /** Message d'erreur lisible, présent si `status` vaut `error` ou `deferred`. */
  detail?: string;
}

export interface SyncPushResponse {
  results: SyncOperationResult[];
  /** Curseur à passer au prochain `pull`. */
  cursor: string;
  serverTime: string;
}

/** Sélectionne le schéma de payload correspondant à une entité. */
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

/** Ordre de rejeu recommandé quand deux opérations ont le même `localSeq`. */
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

/** Tri canonique d'un lot : `localSeq` d'abord, priorité d'entité en départage. */
export function sortOperations<T extends { localSeq: number; entity: SyncEntity }>(
  operations: T[]
): T[] {
  return [...operations].sort(
    (a, b) =>
      a.localSeq - b.localSeq || SYNC_ENTITY_PRIORITY[a.entity] - SYNC_ENTITY_PRIORITY[b.entity]
  );
}
