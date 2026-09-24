/**
 * Module **Market** — marchandise généraliste, conditionnement et péremption.
 *
 * La péremption réutilise les **lots** du noyau (`stock_items.lot_number`) : ce module
 * n'ajoute que la DLC, l'unité de mesure et la catégorie de taxe ([BR-14], Q5). Un lot
 * dont la DLC approche remonte dans les alertes sans logique de stock dupliquée.
 */

import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { addDays, todayInput } from "@shared/format";
import { MEASURE_UNITS, marketProfiles, productLots, products } from "@shared/schema";
import type { Database } from "../../db";
import type { ErpPlugin } from "../../domains/plugins/contract";

const profileSchema = z.object({
  brand: z.string().max(100).default(""),
  measureUnit: z.enum(MEASURE_UNITS).default("UNITE"),
  weightGrams: z.number().int().min(0).default(0),
  volumeMl: z.number().int().min(0).default(0),
  taxCategory: z.string().max(60).default(""),
  isPerishable: z.boolean().default(false),
  expiryAlertDays: z.number().int().min(0).max(365).default(30),
});

export const marketPlugin: ErpPlugin = {
  meta: {
    code: "market",
    name: "Marché / commerce général",
    description:
      "Profil marchandise (marque, poids/volume, unité, catégorie de taxe) et gestion optionnelle des lots avec date limite de consommation.",
    kind: "business",
    defaultEnabled: false,
    version: "1.0.0",
    coreVersion: "^1.0.0",
    dependencies: [],
    profileType: "MARKET",
    icon: "IconShoppingBag",
  },

  permissions: ["market.read", "market.write"],

  navigation: [
    {
      title: "Marché",
      href: "/modules/market",
      icon: "IconShoppingBag",
      permission: "market.read",
      items: [
        { title: "Lots & DLC", href: "/modules/market/lots" },
        { title: "Alertes péremption", href: "/modules/market/expiring" },
      ],
    },
  ],

  searchCriteria: [
    { key: "brand", label: "Marque", type: "text" },
    { key: "isPerishable", label: "Périssable", type: "boolean" },
  ],

  productProfile: {
    profileType: "MARKET",

    async load(database, companyId, productIds) {
      if (productIds.length === 0) return new Map();
      const rows = await database
        .select()
        .from(marketProfiles)
        .where(
          sql`${marketProfiles.companyId} = ${companyId} and ${marketProfiles.productId} = any(${productIds})`
        );
      return new Map(rows.map((row) => [row.productId, row]));
    },

    async save(tx, companyId, productId, payload) {
      const data = profileSchema.parse(payload ?? {});
      await tx
        .insert(marketProfiles)
        .values({ companyId, productId, ...data })
        .onConflictDoUpdate({
          target: marketProfiles.productId,
          set: { ...data, updatedAt: new Date() },
        });
    },

    async remove(tx, companyId, productId) {
      await tx
        .delete(marketProfiles)
        .where(
          sql`${marketProfiles.companyId} = ${companyId} and ${marketProfiles.productId} = ${productId}`
        );
    },

    buildSearchFilter(companyId, query) {
      const brand = typeof query.brand === "string" ? query.brand.trim() : "";
      const isPerishable = query.isPerishable;
      if (!brand && isPerishable == null) return undefined;

      const conditions = [
        brand ? sql`${marketProfiles.brand} ilike ${`%${brand}%`}` : undefined,
        isPerishable != null
          ? sql`${marketProfiles.isPerishable} = ${Boolean(isPerishable)}`
          : undefined,
      ].filter(Boolean);

      return sql`exists (select 1 from ${marketProfiles} where ${marketProfiles.companyId} = ${companyId} and ${marketProfiles.productId} = ${products.id} and ${sql.join(conditions, sql` and `)})`;
    },
  },

  async buildSnapshot(database: Database, companyId: string) {
    const [profiles, lots] = await Promise.all([
      database.select().from(marketProfiles).where(eq(marketProfiles.companyId, companyId)),
      database
        .select()
        .from(productLots)
        .where(and(eq(productLots.companyId, companyId), eq(productLots.isActive, true)))
        .orderBy(asc(productLots.expiryDate))
        .limit(2000),
    ]);
    return { profiles, lots };
  },
};

/** Lots dont la DLC tombe dans la fenêtre d'alerte — utilisé par la route dédiée. */
export async function listExpiringLots(database: Database, companyId: string, withinDays = 30) {
  const today = todayInput();
  return database
    .select({ lot: productLots, productName: products.name, productSku: products.sku })
    .from(productLots)
    .innerJoin(products, eq(products.id, productLots.productId))
    .where(
      and(
        eq(productLots.companyId, companyId),
        eq(productLots.isActive, true),
        gte(productLots.expiryDate, today),
        lte(productLots.expiryDate, addDays(today, withinDays))
      )
    )
    .orderBy(asc(productLots.expiryDate));
}
