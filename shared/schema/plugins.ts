/**
 * Registre de modules (plugins) : installation globale et activation par société.
 *
 * Le noyau ne connaît que ce registre ; il n'importe jamais le code d'un module
 * ([BR-17], [FR-PLUG-3]). Un écran ou un endpoint de module inactif est inaccessible
 * ([BR-12], [FR-PLAT-4]).
 */

import { boolean, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";

import { baseColumns } from "./_base";
import { companies } from "./tenancy";

export const MODULE_CODES = ["auto_parts", "clothing", "market"] as const;
export type ModuleCode = (typeof MODULE_CODES)[number];
export const moduleCodeSchema = z.enum(MODULE_CODES);

export const PLUGIN_STATUSES = ["INSTALLED", "DISABLED", "DEPRECATED"] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

export const installedPlugins = pgTable(
  "installed_plugins",
  {
    ...baseColumns,
    code: text("code").notNull(),
    version: text("version").notNull(),
    /** Version minimale du noyau exigée par le module (SemVer) [FR-PLUG-8]. */
    coreVersion: text("core_version").default("^1.0.0").notNull(),
    status: text("status").$type<PluginStatus>().default("INSTALLED").notNull(),
  },
  (table) => [uniqueIndex("uq_installed_plugins_code").on(table.code)]
);

export type InstalledPlugin = typeof installedPlugins.$inferSelect;

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
    /** Réglages propres au module pour cette société (jamais lus par le noyau). */
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (table) => [uniqueIndex("uq_company_plugins").on(table.companyId, table.pluginCode)]
);

export type CompanyPlugin = typeof companyPlugins.$inferSelect;
