/** Company (tenant) — root of multi-company isolation [BR-13], [FR-PLAT-5]. */

import { boolean, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { baseColumns } from "./_base";

export const ACCOUNTING_STANDARDS = ["OHADA", "PCG", "CGNC", "IFRS"] as const;
export type AccountingStandard = (typeof ACCOUNTING_STANDARDS)[number];

export const companies = pgTable("companies", {
  ...baseColumns,
  name: text("name").notNull(),
  /** Tenant resolution by subdomain [FR-PLAT-7]. */
  subdomain: text("subdomain").notNull().unique(),
  legalName: text("legal_name").default("").notNull(),
  taxId: text("tax_id").default("").notNull(),
  email: text("email").default("").notNull(),
  phone: text("phone").default("").notNull(),
  website: text("website").default("").notNull(),
  address: text("address").default("").notNull(),
  city: text("city").default("").notNull(),
  country: text("country").default("Mauritanie").notNull(),
  /** Single logo (data URI or URL): brand, PWA icon and favicon. */
  logo: text("logo"),
  language: text("language").default("fr").notNull(),
  /** Per-company currency, MRU by default [BR-22]. */
  currency: text("currency").default("MRU").notNull(),
  accountingStandard: text("accounting_standard")
    .$type<AccountingStandard>()
    .default("OHADA")
    .notNull(),
  /** VAT liability: when `false`, every line is computed at 0 %. */
  vatEnabled: boolean("vat_enabled").default(true).notNull(),
  /** Default VAT rate suggested on entry, in basis points. */
  defaultVatRateBp: integer("default_vat_rate_bp").default(1600).notNull(),
  /** Fiscal year start month (1 = January) — used by yearly sequences and the trial balance. */
  fiscalYearStartMonth: integer("fiscal_year_start_month").default(1).notNull(),
  /** Default display domain (theme/UX). NOT normative: activation goes through `company_plugins`. */
  primaryModule: text("primary_module").default("").notNull(),
});

export const insertCompanySchema = createInsertSchema(companies, {
  name: (s) => s.min(1, "Company name is required"),
  subdomain: (s) =>
    s
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/, "Subdomain: lowercase letters, digits and hyphens only"),
  // `drizzle-zod` widens `text().$type<Union>()` columns to `string`: we restore
  // the union so the inferred type stays assignable to the column.
  accountingStandard: () => z.enum(ACCOUNTING_STANDARDS),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

/** Stores / points of sale of a company (multi-store included in multi-tenant). */
export const companySettings = pgTable("company_settings", {
  ...baseColumns,
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").default("").notNull(),
});

export type CompanySetting = typeof companySettings.$inferSelect;
