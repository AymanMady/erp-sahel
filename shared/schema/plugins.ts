/**
 * Modules activables par société (caisse, achats, stock…).
 *
 * L'ERP est générique : un seul catalogue, un seul stock, pour tout type de commerce.
 * Chaque société n'active que les fonctionnalités dont elle se sert, pour garder un
 * menu court. Un écran ou un endpoint de module inactif est inaccessible.
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

/** État d'un module pour une société. Sans ligne, le module est actif (état par défaut). */
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
