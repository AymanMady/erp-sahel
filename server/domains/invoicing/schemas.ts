/** Contrats de validation de la facturation. */

import { z } from "zod";

import { INVOICE_SOURCES, INVOICE_STATUSES } from "@shared/schema";

export const documentLineSchema = z.object({
  productId: z.string().uuid().nullish(),
  variantId: z.string().uuid().nullish(),
  serviceId: z.string().uuid().nullish(),
  productSku: z.string().max(64).optional(),
  description: z.string().max(255).optional(),
  quantity: z.union([z.number(), z.string()]),
  unit: z.string().max(32).optional(),
  unitPriceCents: z.number().int().nullish(),
  discountBp: z.number().int().min(0).max(10_000).default(0),
  vatRateBp: z.number().int().min(0).max(10_000).nullish(),
  originCountry: z.string().max(100).optional(),
});

export const listInvoicesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(INVOICE_STATUSES).nullish(),
  source: z.enum(INVOICE_SOURCES).nullish(),
  partyId: z.string().uuid().nullish(),
  posSessionId: z.string().uuid().nullish(),
  fromDate: z.string().date().nullish(),
  toDate: z.string().date().nullish(),
  unpaidOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createInvoiceSchema = z.object({
  partyId: z.string().uuid("Sélectionnez un client"),
  salesOrderId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid().nullish(),
  source: z.enum(INVOICE_SOURCES).default("MANUAL"),
  date: z.string().date().optional(),
  dueDate: z.string().date().nullish(),
  globalDiscountBp: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().max(4000).default(""),
  lines: z.array(documentLineSchema).min(1, "Ajoutez au moins une ligne"),
  /** Crée directement une facture validée (vente comptoir). */
  validate: z.boolean().default(false),
});

export const updateInvoiceSchema = createInvoiceSchema.partial().omit({ validate: true });

export const createCreditNoteSchema = z.object({
  invoiceId: z.string().uuid(),
  date: z.string().date().optional(),
  reason: z.string().max(2000).default(""),
  /** Réintègre les articles en stock ; `false` pour une marchandise détruite. */
  restock: z.boolean().default(true),
  /** Avoir partiel ; omis, l'avoir reprend toutes les lignes de la facture. */
  lines: z.array(documentLineSchema).min(1).optional(),
});

export const listCreditNotesQuerySchema = z.object({
  invoiceId: z.string().uuid().nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });
