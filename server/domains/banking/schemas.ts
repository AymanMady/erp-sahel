/** Treasury validation contracts. */

import { z } from "zod";

import { BANK_ACCOUNT_TYPES, BANK_TRANSACTION_TYPES } from "@shared/schema";

export const createBankAccountSchema = z.object({
  code: z.string().min(1, "Code is required").max(64),
  name: z.string().min(1, "Label is required").max(255),
  accountType: z.enum(BANK_ACCOUNT_TYPES).default("BANK"),
  accountNumber: z.string().max(64).default(""),
  iban: z.string().max(64).default(""),
  swift: z.string().max(32).default(""),
  currency: z.string().length(3).default("MRU"),
  glAccountId: z.string().uuid().nullish(),
  isDefault: z.boolean().default(false),
});

export const updateBankAccountSchema = createBankAccountSchema.partial();

export const listTransactionsQuerySchema = z.object({
  bankAccountId: z.string().uuid().nullish(),
  fromDate: z.string().date().nullish(),
  toDate: z.string().date().nullish(),
  reconciled: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createTransactionSchema = z.object({
  bankAccountId: z.string().uuid(),
  date: z.string().date(),
  description: z.string().min(1, "Description is required").max(255),
  transactionType: z.enum(BANK_TRANSACTION_TYPES),
  amountCents: z.number().int().positive("Amount must be greater than zero"),
  reference: z.string().max(100).default(""),
});

export const transferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  date: z.string().date(),
  description: z.string().max(255).optional(),
  reference: z.string().max(100).optional(),
});

export const reconcileSchema = z.object({ reconciled: z.boolean() });

export const idParamSchema = z.object({ id: z.string().uuid("Invalid identifier") });
