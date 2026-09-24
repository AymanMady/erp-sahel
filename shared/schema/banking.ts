/** Cash accounts (bank, cash register, mobile money) and transactions [FR-PAY-3]. */

import { boolean, date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { baseColumns, moneyCents } from "./_base";
import { companies } from "./tenancy";

export const BANK_ACCOUNT_TYPES = ["BANK", "CASH", "MOBILE_MONEY"] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    accountType: text("account_type").$type<BankAccountType>().default("BANK").notNull(),
    accountNumber: text("account_number").default("").notNull(),
    iban: text("iban").default("").notNull(),
    swift: text("swift").default("").notNull(),
    currency: text("currency").default("MRU").notNull(),
    /** Balance derived from transactions, recomputed in the same DB transaction as they are. */
    balanceCents: moneyCents("balance_cents").default(0).notNull(),
    /** Linked chart-of-accounts account (512x / 531x in OHADA). */
    glAccountId: uuid("gl_account_id"),
    isDefault: boolean("is_default").default(false).notNull(),
  },
  (table) => [uniqueIndex("uq_bank_accounts_company_code").on(table.companyId, table.code)]
);

export type BankAccount = typeof bankAccounts.$inferSelect;

export const BANK_TRANSACTION_TYPES = ["DEPOSIT", "WITHDRAWAL", "TRANSFER"] as const;
export type BankTransactionType = (typeof BANK_TRANSACTION_TYPES)[number];

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    /** Destination account for an internal transfer. */
    counterpartAccountId: uuid("counterpart_account_id").references(() => bankAccounts.id, {
      onDelete: "set null",
    }),
    date: date("date").notNull(),
    description: text("description").notNull(),
    transactionType: text("transaction_type").$type<BankTransactionType>().notNull(),
    amountCents: moneyCents("amount_cents").notNull(),
    reference: text("reference").default("").notNull(),
    /** Reconciliation: matched with a payment or a statement [FR-PAY-3]. */
    reconciled: boolean("reconciled").default(false).notNull(),
    paymentId: uuid("payment_id"),
  },
  (table) => [
    index("idx_bank_transactions_account_date").on(table.bankAccountId, table.date),
    index("idx_bank_transactions_payment").on(table.paymentId),
  ]
);

export type BankTransaction = typeof bankTransactions.$inferSelect;
