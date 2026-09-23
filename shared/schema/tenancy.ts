/** Société (tenant) — racine de l'isolation multi-société [BR-13], [FR-PLAT-5]. */

import { boolean, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { baseColumns } from "./_base";

export const ACCOUNTING_STANDARDS = ["OHADA", "PCG", "CGNC", "IFRS"] as const;
export type AccountingStandard = (typeof ACCOUNTING_STANDARDS)[number];

export const companies = pgTable("companies", {
  ...baseColumns,
  name: text("name").notNull(),
  /** Résolution du tenant par sous-domaine [FR-PLAT-7]. */
  subdomain: text("subdomain").notNull().unique(),
  legalName: text("legal_name").default("").notNull(),
  taxId: text("tax_id").default("").notNull(),
  email: text("email").default("").notNull(),
  phone: text("phone").default("").notNull(),
  website: text("website").default("").notNull(),
  address: text("address").default("").notNull(),
  city: text("city").default("").notNull(),
  country: text("country").default("Mauritanie").notNull(),
  /** Logo unique (data URI ou URL) : enseigne, icône PWA et favicon. */
  logo: text("logo"),
  language: text("language").default("fr").notNull(),
  /** Devise par société, MRU par défaut [BR-22]. */
  currency: text("currency").default("MRU").notNull(),
  accountingStandard: text("accounting_standard")
    .$type<AccountingStandard>()
    .default("OHADA")
    .notNull(),
  /** Assujettissement TVA : quand `false`, toutes les lignes sont calculées à 0 %. */
  vatEnabled: boolean("vat_enabled").default(true).notNull(),
  /** Taux de TVA par défaut proposé à la saisie, en points de base. */
  defaultVatRateBp: integer("default_vat_rate_bp").default(1600).notNull(),
  /** Mois de début d'exercice (1 = janvier) — sert aux séquences annuelles et à la balance. */
  fiscalYearStartMonth: integer("fiscal_year_start_month").default(1).notNull(),
  /** Domaine d'affichage par défaut (thème/UX). NON normatif : l'activation passe par `company_plugins`. */
  primaryModule: text("primary_module").default("").notNull(),
});

export const insertCompanySchema = createInsertSchema(companies, {
  name: (s) => s.min(1, "Le nom de la société est obligatoire"),
  subdomain: (s) =>
    s
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/, "Sous-domaine : minuscules, chiffres et tirets uniquement"),
  // `drizzle-zod` élargit les colonnes `text().$type<Union>()` en `string` : on
  // restaure l'union pour que le type inféré reste assignable à la colonne.
  accountingStandard: () => z.enum(ACCOUNTING_STANDARDS),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

/** Magasins / points de vente d'une société (multi-magasin inclus au multi-tenant). */
export const companySettings = pgTable("company_settings", {
  ...baseColumns,
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").default("").notNull(),
});

export type CompanySetting = typeof companySettings.$inferSelect;
