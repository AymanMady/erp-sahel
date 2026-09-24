/**
 * Point of sale: registers and sessions [FR-POS-1], [FR-POS-2].
 *
 * A POS ticket **is** a sales invoice (`sales_invoices.source = 'POS'`): the
 * stock → accounting chain is then strictly identical to the back-office one, which
 * avoids maintaining a second accounting pipeline.
 */

import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { baseColumns, clientUuid, moneyCents } from "./_base";
import { users } from "./accounts";
import { bankAccounts } from "./banking";
import { warehouses } from "./inventory";
import { companies } from "./tenancy";

export const posRegisters = pgTable(
  "pos_registers",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    /** Cash account credited by this register's cash receipts. */
    cashAccountId: uuid("cash_account_id").references(() => bankAccounts.id, {
      onDelete: "set null",
    }),
    isOpenAllowed: boolean("is_open_allowed").default(true).notNull(),
  },
  (table) => [uniqueIndex("uq_pos_registers_company_code").on(table.companyId, table.code)]
);

export type PosRegister = typeof posRegisters.$inferSelect;

export const POS_SESSION_STATUSES = ["OPEN", "CLOSED"] as const;
export type PosSessionStatus = (typeof POS_SESSION_STATUSES)[number];

export const posSessions = pgTable(
  "pos_sessions",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    registerId: uuid("register_id")
      .notNull()
      .references(() => posRegisters.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Opening float declared when the session opens. */
    openingBalanceCents: moneyCents("opening_balance_cents").default(0).notNull(),
    /** Amount physically counted at closing. */
    closingBalanceCents: moneyCents("closing_balance_cents").default(0).notNull(),
    /** Float + cash receipts: what the register *should* contain. */
    expectedBalanceCents: moneyCents("expected_balance_cents").default(0).notNull(),
    totalSalesCents: moneyCents("total_sales_cents").default(0).notNull(),
    totalCashCents: moneyCents("total_cash_cents").default(0).notNull(),
    ticketCount: moneyCents("ticket_count").default(0).notNull(),
    status: text("status").$type<PosSessionStatus>().default("OPEN").notNull(),
    notes: text("notes").default("").notNull(),
    clientUuid: clientUuid(),
  },
  (table) => [
    uniqueIndex("uq_pos_sessions_client_uuid").on(table.clientUuid),
    index("idx_pos_sessions_register_status").on(table.registerId, table.status),
    index("idx_pos_sessions_company_opened").on(table.companyId, table.openedAt),
  ]
);

export type PosSession = typeof posSessions.$inferSelect;
