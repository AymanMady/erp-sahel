/**
 * Integration test utilities.
 *
 * Each test works in **its own company**: multi-tenant isolation being a product
 * invariant ([BR-13]), using it as the test isolation mechanism checks the invariant
 * while avoiding interference.
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

/** Creates a complete, disposable company, ready to invoice. */
export async function createTestCompany(label = "test"): Promise<TestContext> {
  const suffix = randomUUID().slice(0, 8);
  const company = await tenancyApplication.create({
    name: `Company ${label} ${suffix}`,
    subdomain: `t-${label}-${suffix}`.toLowerCase().slice(0, 60),
    currency: "MRU",
    accountingStandard: "OHADA",
    vatEnabled: true,
    defaultVatRateBp: 1600,
  });

  // Tests cover every domain: every module is enabled.
  await moduleRegistry.applySelection(
    company.id,
    FEATURE_MODULES.map((module) => module.code)
  );

  const [user] = await db
    .insert(users)
    .values({
      username: `u-${suffix}`,
      passwordHash: await hashPassword("Test1234!"),
      firstName: "Tester",
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

/** Creates a product with initial stock. */
export async function createStockedProduct(
  context: TestContext,
  options: { sku?: string; salePriceCents?: number; quantity?: number; vatRateBp?: number } = {}
) {
  return catalogApplication.create(
    context.company.id,
    {
      sku: options.sku ?? `ART-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: "Test item",
      description: "",
      categoryId: null,
      unit: "piece",
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

/** Deletes the test company (cascades to all its data). */
export async function dropTestCompany(context: TestContext): Promise<void> {
  const { companies } = await import("@shared/schema");
  await db.delete(companies).where(eq(companies.id, context.company.id));
  await db.delete(users).where(eq(users.id, context.userId));
}
