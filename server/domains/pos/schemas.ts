/** Contrats de validation du point de vente. */

import { z } from "zod";

import { PAYMENT_METHODS, POS_SESSION_STATUSES } from "@shared/schema";
import { documentLineSchema } from "../invoicing/schemas";

export const createRegisterSchema = z.object({
  code: z.string().min(1, "Le code est obligatoire").max(64),
  name: z.string().min(1, "Le nom est obligatoire").max(255),
  warehouseId: z.string().uuid("Sélectionnez un magasin"),
  cashAccountId: z.string().uuid().nullish(),
  isOpenAllowed: z.boolean().default(true),
});

export const updateRegisterSchema = createRegisterSchema.partial();

export const openSessionSchema = z.object({
  registerId: z.string().uuid("Sélectionnez une caisse"),
  openingBalanceCents: z.number().int().min(0).default(0),
  openedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).default(""),
});

export const closeSessionSchema = z.object({
  closingBalanceCents: z.number().int().min(0),
  closedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});

export const ticketPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountCents: z.number().int().positive(),
  reference: z.string().max(100).optional(),
  bankAccountId: z.string().uuid().nullish(),
});

export const createTicketSchema = z.object({
  sessionId: z.string().uuid(),
  partyId: z.string().uuid().nullish(),
  date: z.string().date().optional(),
  globalDiscountBp: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().max(2000).default(""),
  lines: z.array(documentLineSchema).min(1, "Le panier est vide"),
  payments: z.array(ticketPaymentSchema).min(1, "Indiquez au moins un règlement"),
});

export const listSessionsQuerySchema = z.object({
  registerId: z.string().uuid().nullish(),
  status: z.enum(POS_SESSION_STATUSES).nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });
