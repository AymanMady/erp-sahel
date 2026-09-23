/** Contrats de validation de la comptabilité. */

import { z } from "zod";

import { ACCOUNT_MAPPING_KEYS, ACCOUNT_TYPES, JOURNAL_TYPES } from "@shared/schema";

export const createAccountSchema = z.object({
  code: z.string().min(1, "Le numéro de compte est obligatoire").max(32),
  name: z.string().min(1, "Le libellé est obligatoire").max(255),
  accountType: z.enum(ACCOUNT_TYPES),
  parentId: z.string().uuid().nullish(),
  isGroup: z.boolean().default(false),
  reconciliationAllowed: z.boolean().default(true),
});

export const updateAccountSchema = createAccountSchema.partial();

export const createJournalSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(255),
  journalType: z.enum(JOURNAL_TYPES),
  defaultAccountId: z.string().uuid().nullish(),
});

export const updateJournalSchema = createJournalSchema.partial();

export const mappingSchema = z.object({
  key: z.enum(ACCOUNT_MAPPING_KEYS),
  accountId: z.string().uuid(),
});

export const periodQuerySchema = z.object({
  fromDate: z.string().date().nullish(),
  toDate: z.string().date().nullish(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const listEntriesQuerySchema = periodQuerySchema.extend({
  journalId: z.string().uuid().nullish(),
});

export const ledgerQuerySchema = periodQuerySchema.extend({
  accountId: z.string().uuid().nullish(),
});

export const manualEntrySchema = z.object({
  journalType: z.enum(JOURNAL_TYPES).default("MISC"),
  date: z.string().date(),
  label: z.string().min(1, "Le libellé est obligatoire").max(255),
  reference: z.string().max(100).default(""),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        debitCents: z.number().int().min(0).default(0),
        creditCents: z.number().int().min(0).default(0),
        label: z.string().max(255).default(""),
        partyId: z.string().uuid().nullish(),
      })
    )
    .min(2, "Une écriture comporte au moins deux lignes"),
});

export const createFiscalYearSchema = z.object({
  name: z.string().min(1).max(100),
  startDate: z.string().date(),
  endDate: z.string().date(),
});

export const idParamSchema = z.object({ id: z.string().uuid("Identifiant invalide") });
