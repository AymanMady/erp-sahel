/** Party validation contracts. */

import { z } from "zod";

import { ADDRESS_TYPES, PARTY_TYPES } from "@shared/schema";

export const listPartiesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  partyType: z.enum(PARTY_TYPES).nullish(),
  role: z.enum(["CUSTOMER", "SUPPLIER"]).nullish(),
  includeArchived: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createPartySchema = z.object({
  /** When left empty, the code is assigned automatically (`CLI-0001`). */
  code: z.string().trim().max(64).optional(),
  name: z.string().min(1, "Name is required").max(255),
  partyType: z.enum(PARTY_TYPES).default("CUSTOMER"),
  email: z.string().email("Invalid email address").or(z.literal("")).default(""),
  phone: z.string().max(64).default(""),
  vatNumber: z.string().max(64).default(""),
  creditLimitCents: z.number().int().min(0).default(0),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  defaultLeadTimeDays: z.number().int().min(0).max(365).default(0),
  assignedToId: z.string().uuid().nullish(),
  notes: z.string().max(4000).default(""),
});

export const updatePartySchema = createPartySchema.partial();

export const contactSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().max(100).default(""),
  email: z.string().email("Invalid email address").or(z.literal("")).default(""),
  phone: z.string().max(64).default(""),
  role: z.string().max(100).default(""),
});

export const addressSchema = z.object({
  addressType: z.enum(ADDRESS_TYPES).default("BILLING"),
  street: z.string().max(255).default(""),
  city: z.string().max(100).default(""),
  postalCode: z.string().max(32).default(""),
  /** Defaults to the translated "Mauritania" at creation time (see the service). */
  country: z.string().max(100).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid("Invalid identifier") });
