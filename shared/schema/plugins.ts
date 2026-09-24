/**
 * Modules that can be enabled per company (POS, purchasing, stock…).
 *
 * The ERP is generic: a single catalog, a single stock, for any kind of business.
 * Each company only enables the features it uses, to keep the menu short. A screen or
 * endpoint of a disabled module is inaccessible.
 */

import { boolean, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";

import { baseColumns } from "./_base";
import { companies } from "./tenancy";

export const MODULE_CODES = [
  "pos",
  "sales",
  "invoicing",
  "purchasing",
  "inventory",
  "services",
  "banking",
  "accounting",
  "reports",
] as const;
export type ModuleCode = (typeof MODULE_CODES)[number];
export const moduleCodeSchema = z.enum(MODULE_CODES);

/** State of a module for a company. Without a row, the module is enabled (default state). */
export const companyPlugins = pgTable(
  "company_plugins",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    pluginCode: text("plugin_code").notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    enabledVersion: text("enabled_version").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (table) => [uniqueIndex("uq_company_plugins").on(table.companyId, table.pluginCode)]
);

export type CompanyPlugin = typeof companyPlugins.$inferSelect;
