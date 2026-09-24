/**
 * Module **Clothing** — profil vêtement et déclinaisons taille × couleur.
 *
 * Aucune table de stock propre : les combinaisons taille/couleur sont des
 * `product_variants` du noyau, avec leur code-barres et leur stock ([BR-14]). Ce module
 * n'ajoute que ce que le noyau ne peut pas deviner : marque, genre, saison, matière,
 * collection et grilles de tailles.
 */

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  GENDERS,
  SEASONS,
  clothingProfiles,
  productVariants,
  products,
  sizeGrids,
} from "@shared/schema";
import type { Database } from "../../db";
import type { ErpPlugin } from "../../domains/plugins/contract";

const profileSchema = z.object({
  brand: z.string().max(100).default(""),
  gender: z.enum(GENDERS).default("MIXTE"),
  season: z.enum(SEASONS).default("TOUTE_SAISON"),
  material: z.string().max(100).default(""),
  collection: z.string().max(100).default(""),
  sizeGridId: z.string().uuid().nullish(),
  colors: z.array(z.string().max(40)).default([]),
});

/** Grilles proposées à l'activation — modifiables ensuite par la société. */
const DEFAULT_SIZE_GRIDS = [
  { name: "Lettres (S → XXL)", sizes: ["XS", "S", "M", "L", "XL", "XXL"] },
  {
    name: "Chaussures EU (36 → 46)",
    sizes: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"],
  },
  { name: "Enfant (2 → 14 ans)", sizes: ["2A", "4A", "6A", "8A", "10A", "12A", "14A"] },
];

export const clothingPlugin: ErpPlugin = {
  meta: {
    code: "clothing",
    name: "Vêtements",
    description:
      "Profil vêtement (marque, genre, saison, matière, collection), grilles de tailles et déclinaisons taille × couleur.",
    kind: "business",
    defaultEnabled: false,
    version: "1.0.0",
    coreVersion: "^1.0.0",
    dependencies: [],
    profileType: "CLOTHING",
    icon: "IconShirt",
  },

  permissions: ["clothing.read", "clothing.write"],

  navigation: [
    {
      title: "Vêtements",
      href: "/modules/clothing",
      icon: "IconShirt",
      permission: "clothing.read",
      items: [
        { title: "Collections", href: "/modules/clothing/collections" },
        { title: "Grilles de tailles", href: "/modules/clothing/size-grids" },
      ],
    },
  ],

  searchCriteria: [
    { key: "brand", label: "Marque", type: "text" },
    { key: "gender", label: "Genre", type: "select" },
    { key: "season", label: "Saison", type: "select" },
    { key: "size", label: "Taille", type: "text" },
    { key: "color", label: "Couleur", type: "text" },
  ],

  productProfile: {
    profileType: "CLOTHING",

    async load(database, companyId, productIds) {
      if (productIds.length === 0) return new Map();
      const rows = await database
        .select({ profile: clothingProfiles, sizeGridName: sizeGrids.name })
        .from(clothingProfiles)
        .leftJoin(sizeGrids, eq(sizeGrids.id, clothingProfiles.sizeGridId))
        .where(
          sql`${clothingProfiles.companyId} = ${companyId} and ${clothingProfiles.productId} = any(${productIds})`
        );
      return new Map(
        rows.map((row) => [
          row.profile.productId,
          { ...row.profile, sizeGridName: row.sizeGridName },
        ])
      );
    },

    async save(tx, companyId, productId, payload) {
      const data = profileSchema.parse(payload ?? {});
      await tx
        .insert(clothingProfiles)
        .values({ companyId, productId, ...data, sizeGridId: data.sizeGridId ?? null })
        .onConflictDoUpdate({
          target: clothingProfiles.productId,
          set: { ...data, sizeGridId: data.sizeGridId ?? null, updatedAt: new Date() },
        });
    },

    async remove(tx, companyId, productId) {
      await tx
        .delete(clothingProfiles)
        .where(
          sql`${clothingProfiles.companyId} = ${companyId} and ${clothingProfiles.productId} = ${productId}`
        );
    },

    /**
     * Les filtres taille et couleur portent sur les **attributs de variante**, pas sur
     * le profil : deux variantes du même produit peuvent différer sur ces axes.
     */
    buildSearchFilter(companyId, query) {
      const brand = typeof query.brand === "string" ? query.brand.trim() : "";
      const gender = typeof query.gender === "string" ? query.gender.trim() : "";
      const season = typeof query.season === "string" ? query.season.trim() : "";
      const size = typeof query.size === "string" ? query.size.trim() : "";
      const color = typeof query.color === "string" ? query.color.trim() : "";

      if (!brand && !gender && !season && !size && !color) return undefined;

      const profileConditions = [
        brand ? sql`${clothingProfiles.brand} ilike ${`%${brand}%`}` : undefined,
        gender ? sql`${clothingProfiles.gender} = ${gender}` : undefined,
        season ? sql`${clothingProfiles.season} = ${season}` : undefined,
      ].filter(Boolean);

      const variantConditions = [
        size ? sql`${productVariants.attributes} ->> 'size' = ${size}` : undefined,
        color ? sql`${productVariants.attributes} ->> 'color' ilike ${color}` : undefined,
      ].filter(Boolean);

      const parts = [] as ReturnType<typeof sql>[];
      if (profileConditions.length > 0) {
        parts.push(
          sql`exists (select 1 from ${clothingProfiles} where ${clothingProfiles.companyId} = ${companyId} and ${clothingProfiles.productId} = ${products.id} and ${sql.join(profileConditions, sql` and `)})`
        );
      }
      if (variantConditions.length > 0) {
        parts.push(
          sql`exists (select 1 from ${productVariants} where ${productVariants.companyId} = ${companyId} and ${productVariants.productId} = ${products.id} and ${sql.join(variantConditions, sql` and `)})`
        );
      }
      return sql.join(parts, sql` and `);
    },
  },

  /** Grilles de tailles par défaut, posées à l'activation pour la société. */
  async enable(tx: Database, companyId: string) {
    for (const grid of DEFAULT_SIZE_GRIDS) {
      await tx
        .insert(sizeGrids)
        .values({ companyId, name: grid.name, sizes: grid.sizes })
        .onConflictDoNothing();
    }
  },

  async buildSnapshot(database: Database, companyId: string) {
    const [profiles, grids] = await Promise.all([
      database.select().from(clothingProfiles).where(eq(clothingProfiles.companyId, companyId)),
      database.select().from(sizeGrids).where(eq(sizeGrids.companyId, companyId)),
    ]);
    return { profiles, sizeGrids: grids };
  },
};
