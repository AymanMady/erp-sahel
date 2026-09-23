/** Contrats de validation des devis et commandes. */

import { z } from "zod";

import { QUOTE_STATUSES, SALES_ORDER_STATUSES } from "@shared/schema";
import { documentLineSchema } from "../invoicing/schemas";

export const listSalesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  partyId: z.string().uuid().nullish(),
  fromDate: z.string().date().nullish(),
  toDate: z.string().date().nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const listQuotesQuerySchema = listSalesQuerySchema.extend({
  status: z.enum(QUOTE_STATUSES).nullish(),
});

export const listOrdersQuerySchema = listSalesQuerySchema.extend({
  status: z.enum(SALES_ORDER_STATUSES).nullish(),
});

export const createQuoteSchema = z.object({
  partyId: z.string().uuid("Sélectionnez un client"),
  date: z.string().date().optional(),
  expiryDate: z.string().date().nullish(),
  globalDiscountBp: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().max(4000).default(""),
  lines: z.array(documentLineSchema).min(1, "Ajoutez au moins une ligne"),
});

export const updateQuoteSchema = createQuoteSchema.partial();

export const createOrderSchema = createQuoteSchema
  .omit({ expiryDate: true })
  .extend({ deliveryDate: z.string().date().nullish(), quoteId: z.string().uuid().nullish() });

export const quoteStatusSchema = z.object({ status: z.enum(QUOTE_STATUSES) });
export const orderStatusSchema = z.object({ status: z.enum(SALES_ORDER_STATUSES) });

export const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });
