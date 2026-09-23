/**
 * Comptabilité : plan comptable **configurable** (OHADA par défaut), journaux, écritures.
 *
 * Le référentiel n'est pas codé en dur ([BR-21], Q1) : le plan est une table de données
 * et les comptes utilisés par les automatismes (vente, TVA, client, caisse…) sont résolus
 * via `account_mappings`. Passer d'OHADA à PCG/CGNC/IFRS ne demande qu'un nouveau jeu de
 * données + mappings, sans refonte du modèle.
 */

import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { baseColumns, clientUuid, moneyCents } from "./_base";
import { parties } from "./parties";
import { companies } from "./tenancy";

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const accounts = pgTable(
  "accounts",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    accountType: text("account_type").$type<AccountType>().notNull(),
    parentId: uuid("parent_id"),
    /** Compte de regroupement : ne reçoit pas d'écriture directe. */
    isGroup: boolean("is_group").default(false).notNull(),
    reconciliationAllowed: boolean("reconciliation_allowed").default(true).notNull(),
  },
  (table) => [
    uniqueIndex("uq_accounts_company_code").on(table.companyId, table.code),
    index("idx_accounts_company_type").on(table.companyId, table.accountType),
  ]
);

export type Account = typeof accounts.$inferSelect;

/**
 * Comptes utilisés par les automatismes comptables.
 * Une clé logique (`SALES_REVENUE`, `VAT_COLLECTED`…) → un compte du plan de la société.
 */
export const ACCOUNT_MAPPING_KEYS = [
  "SALES_REVENUE",
  "SALES_DISCOUNT",
  "VAT_COLLECTED",
  "VAT_DEDUCTIBLE",
  "CUSTOMER_RECEIVABLE",
  "SUPPLIER_PAYABLE",
  "PURCHASES",
  "INVENTORY",
  "INVENTORY_VARIATION",
  "CASH",
  "BANK",
  "MOBILE_MONEY",
  "ROUNDING_DIFFERENCE",
  "OPENING_BALANCE",
  "RESULT_CARRY_FORWARD",
] as const;
export type AccountMappingKey = (typeof ACCOUNT_MAPPING_KEYS)[number];

export const accountMappings = pgTable(
  "account_mappings",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    key: text("key").$type<AccountMappingKey>().notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("uq_account_mappings").on(table.companyId, table.key)]
);

export type AccountMapping = typeof accountMappings.$inferSelect;

export const JOURNAL_TYPES = ["SALES", "PURCHASES", "BANK", "CASH", "MISC"] as const;
export type JournalType = (typeof JOURNAL_TYPES)[number];

export const journals = pgTable(
  "journals",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    journalType: text("journal_type").$type<JournalType>().notNull(),
    defaultAccountId: uuid("default_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
  },
  (table) => [uniqueIndex("uq_journals_company_code").on(table.companyId, table.code)]
);

export type Journal = typeof journals.$inferSelect;

export const fiscalYears = pgTable(
  "fiscal_years",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    isClosed: boolean("is_closed").default(false).notNull(),
  },
  (table) => [uniqueIndex("uq_fiscal_years_company_name").on(table.companyId, table.name)]
);

export type FiscalYear = typeof fiscalYears.$inferSelect;

export const ENTRY_ORIGINS = [
  "sales_invoice",
  "credit_note",
  "supplier_invoice",
  "payment",
  "bank_transaction",
  "pos_session",
  "inventory_count",
  "manual",
  "opening",
] as const;
export type EntryOrigin = (typeof ENTRY_ORIGINS)[number];

/**
 * Écriture comptable. L'équilibre débit = crédit est vérifié **avant** insertion
 * (`assertBalanced`) et re-vérifié par une contrainte d'intégrité applicative [FR-CPT-1].
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => journals.id),
    fiscalYearId: uuid("fiscal_year_id").references(() => fiscalYears.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    reference: text("reference").default("").notNull(),
    label: text("label").default("").notNull(),
    originType: text("origin_type").$type<EntryOrigin>().default("manual").notNull(),
    originId: uuid("origin_id"),
    isValidated: boolean("is_validated").default(false).notNull(),
    totalDebitCents: moneyCents("total_debit_cents").default(0).notNull(),
    totalCreditCents: moneyCents("total_credit_cents").default(0).notNull(),
    clientUuid: clientUuid(),
  },
  (table) => [
    uniqueIndex("uq_journal_entries_company_number").on(table.companyId, table.number),
    uniqueIndex("uq_journal_entries_client_uuid").on(table.clientUuid),
    index("idx_journal_entries_company_date").on(table.companyId, table.date),
    index("idx_journal_entries_origin").on(table.originType, table.originId),
  ]
);

export type JournalEntry = typeof journalEntries.$inferSelect;

export const journalLines = pgTable(
  "journal_lines",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    debitCents: moneyCents("debit_cents").default(0).notNull(),
    creditCents: moneyCents("credit_cents").default(0).notNull(),
    label: text("label").default("").notNull(),
    /** Tiers rattaché : permet le grand livre auxiliaire clients/fournisseurs. */
    partyId: uuid("party_id").references(() => parties.id, { onDelete: "set null" }),
    reconciled: boolean("reconciled").default(false).notNull(),
    position: integer("position").default(0).notNull(),
  },
  (table) => [
    index("idx_journal_lines_entry").on(table.entryId),
    index("idx_journal_lines_account").on(table.companyId, table.accountId),
  ]
);

export type JournalLine = typeof journalLines.$inferSelect;
