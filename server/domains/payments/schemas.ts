/** Contrats de validation des règlements. */

import { z } from "zod";

import { PAYMENT_DIRECTIONS, PAYMENT_METHODS } from "@shared/schema";

export const listPaymentsQuerySchema = z.object({
  partyId: z.string().uuid().nullish(),
  invoiceId: z.string().uuid().nullish(),
  posSessionId: z.string().uuid().nullish(),
  direction: z.enum(PAYMENT_DIRECTIONS).nullish(),
  method: z.enum(PAYMENT_METHODS).nullish(),
  fromDate: z.string().date().nullish(),
  toDate: z.string().date().nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createPaymentSchema = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS).default("IN"),
  partyId: z.string().uuid("Sélectionnez un tiers"),
  invoiceId: z.string().uuid().nullish(),
  supplierInvoiceId: z.string().uuid().nullish(),
  bankAccountId: z.string().uuid().nullish(),
  amountCents: z.number().int().positive("Le montant doit être supérieur à zéro"),
  paymentDate: z.string().date().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  reference: z.string().max(100).default(""),
  notes: z.string().max(2000).default(""),
  posSessionId: z.string().uuid().nullish(),
});

export const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });
