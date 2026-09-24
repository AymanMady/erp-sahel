/**
 * Utilitaires des tests d'intégration.
 *
 * Chaque test travaille dans **sa propre société** : l'isolation multi-tenant étant un
 * invariant du produit ([BR-13]), l'utiliser comme mécanisme d'isolation des tests
 * vérifie l'invariant en même temps qu'elle évite les interférences.
 */

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Company } from "@shared/schema";
import { posRegisters, users, warehouses } from "@shared/schema";
import { FEATURE_MODULES } from "@shared/modules-catalog";
import { db } from "../db";
import { moduleRegistry } from "../domains/plugins/registry";
import { hashPassword } from "../domains/auth/application";
import { catalogApplication } from "../domains/catalog/application";
import { tenancyApplication } from "../domains/tenancy/application";
import "../domains/sync/handlers";

export interface TestContext {
  company: Company;
  userId: string;
  warehouseId: string;
  registerId: string;
}

/** Crée une société complète et jetable, prête à facturer. */
export async function createTestCompany(label = "test"): Promise<TestContext> {
  const suffix = randomUUID().slice(0, 8);
  const company = await tenancyApplication.create({
    name: `Société ${label} ${suffix}`,
    subdomain: `t-${label}-${suffix}`.toLowerCase().slice(0, 60),
    currency: "MRU",
    accountingStandard: "OHADA",
    vatEnabled: true,
    defaultVatRateBp: 1600,
  });

  // Les tests couvrent tous les domaines : tous les modules sont activés.
  await moduleRegistry.applySelection(
    company.id,
    FEATURE_MODULES.map((module) => module.code)
  );

  const [user] = await db
    .insert(users)
    .values({
      username: `u-${suffix}`,
      passwordHash: await hashPassword("Test1234!"),
      firstName: "Testeur",
    })
    .returning();

  const [warehouse] = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.companyId, company.id))
    .limit(1);
  const [register] = await db
    .select()
    .from(posRegisters)
    .where(eq(posRegisters.companyId, company.id))
    .limit(1);

  return {
    company,
    userId: user.id,
    warehouseId: warehouse.id,
    registerId: register.id,
  };
}

/** Crée un produit avec du stock initial. */
export async function createStockedProduct(
  context: TestContext,
  options: { sku?: string; salePriceCents?: number; quantity?: number; vatRateBp?: number } = {}
) {
  return catalogApplication.create(
    context.company.id,
    {
      sku: options.sku ?? `ART-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: "Article de test",
      description: "",
      categoryId: null,
      unit: "pièce",
      barcode: "",
      purchasePriceCents: 1_000,
      salePriceCents: options.salePriceCents ?? 10_000,
      vatRateBp: options.vatRateBp ?? 1600,
      isService: false,
      imageUrls: [],
      minStock: "0",
      variants: [],
      initialStock: {
        warehouseId: context.warehouseId,
        quantity: options.quantity ?? 100,
        unitCostCents: 1_000,
      },
    },
    context.userId
  );
}

/** Supprime la société de test (cascade sur toutes ses données). */
export async function dropTestCompany(context: TestContext): Promise<void> {
  const { companies } = await import("@shared/schema");
  await db.delete(companies).where(eq(companies.id, context.company.id));
  await db.delete(users).where(eq(users.id, context.userId));
}
