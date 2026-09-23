/** Prestations facturables sans gestion de stock (main d'œuvre, forfaits) [FR-PROD-5]. */

import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { baseColumns, moneyCents, rateBp } from "./_base";
import { companies } from "./tenancy";

export const BILLING_TYPES = ["HOURLY", "DAILY", "FLAT"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const services = pgTable(
  "services",
  {
    ...baseColumns,
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    billingType: text("billing_type").$type<BillingType>().default("HOURLY").notNull(),
    priceCents: moneyCents("price_cents").default(0).notNull(),
    vatRateBp: rateBp("vat_rate_bp").default(0).notNull(),
  },
  (table) => [uniqueIndex("uq_services_company_code").on(table.companyId, table.code)]
);

export const insertServiceSchema = createInsertSchema(services, {
  code: (s) => s.min(1, "Le code est obligatoire"),
  name: (s) => s.min(1, "Le libellé est obligatoire"),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof services.$inferSelect;
