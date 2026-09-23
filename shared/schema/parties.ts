/** Tiers : clients, fournisseurs, prospects — un tiers peut cumuler les rôles [FR-TIERS-3]. */

import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { baseColumns, clientUuid, moneyCents } from "./_base";
import { users } from "./accounts";
import { companies } from "./tenancy";

export const PARTY_TYPES = ["CUSTOMER", "SUPPLIER", "BOTH", "PROSPECT"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const parties = pgTable(
  "parties",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    partyType: text("party_type").$type<PartyType>().default("CUSTOMER").notNull(),
    email: text("email").default("").notNull(),
    phone: text("phone").default("").notNull(),
    /** Identifiant fiscal (NIF) — critère de recherche [FR-TIERS-4]. */
    vatNumber: text("vat_number").default("").notNull(),
    creditLimitCents: moneyCents("credit_limit_cents").default(0).notNull(),
    /** Conditions de paiement en jours (échéance = date document + N jours). */
    paymentTermsDays: integer("payment_terms_days").default(0).notNull(),
    /** Délai de livraison par défaut du fournisseur [FR-TIERS-2]. */
    defaultLeadTimeDays: integer("default_lead_time_days").default(0).notNull(),
    assignedToId: uuid("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes").default("").notNull(),
    clientUuid: clientUuid(),
  },
  (table) => [
    uniqueIndex("uq_parties_company_code").on(table.companyId, table.code),
    uniqueIndex("uq_parties_client_uuid").on(table.clientUuid),
    index("idx_parties_company_name").on(table.companyId, table.name),
    index("idx_parties_company_type").on(table.companyId, table.partyType),
  ]
);

export const insertPartySchema = createInsertSchema(parties, {
  name: (s) => s.min(1, "Le nom du tiers est obligatoire"),
  email: (s) => s.email("Adresse e-mail invalide").or(z.literal("")),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertParty = z.infer<typeof insertPartySchema>;
export type Party = typeof parties.$inferSelect;

export const contacts = pgTable(
  "contacts",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").default("").notNull(),
    email: text("email").default("").notNull(),
    phone: text("phone").default("").notNull(),
    role: text("role").default("").notNull(),
  },
  (table) => [index("idx_contacts_party").on(table.partyId)]
);

export type Contact = typeof contacts.$inferSelect;

export const ADDRESS_TYPES = ["BILLING", "SHIPPING", "OTHER"] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

export const partyAddresses = pgTable(
  "party_addresses",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    addressType: text("address_type").$type<AddressType>().default("BILLING").notNull(),
    street: text("street").default("").notNull(),
    city: text("city").default("").notNull(),
    postalCode: text("postal_code").default("").notNull(),
    country: text("country").default("Mauritanie").notNull(),
  },
  (table) => [index("idx_party_addresses_party").on(table.partyId)]
);

export type PartyAddress = typeof partyAddresses.$inferSelect;
