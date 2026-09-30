/**
 * Saving a product keeps its variants in place.
 *
 * Variants used to be deleted and recreated on every save: new ids each time, and —
 * because `stock_items.variant_id` cascades — the stock line of the product (with its
 * movements) deleted along with them. Stock, sales lines and offline workstations all
 * refer to a variant by id: it must survive a save.
 */

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { productVariants, stockItems, stockMovements } from "@shared/schema";
import { closeDatabase, db } from "../db";
import { catalogApplication } from "../domains/catalog/application";
import { inventoryApplication } from "../domains/inventory/application";
import { invoicingApplication } from "../domains/invoicing/application";
import { partiesApplication } from "../domains/parties/application";
import { createTestCompany, dropTestCompany, type TestContext } from "./helpers";

let context: TestContext;
let customerId: string;

beforeAll(async () => {
  context = await createTestCompany("variants");
  const customer = await partiesApplication.create(
    context.company.id,
    { name: "Variant customer", partyType: "CUSTOMER" },
    db
  );
  customerId = customer.id;
});

afterAll(async () => {
  await dropTestCompany(context);
  await closeDatabase();
});

const variant = (sku: string, extra: Record<string, unknown> = {}) => ({
  sku,
  barcode: "",
  attributes: {},
  salePriceCents: null,
  isDefault: false,
  ...extra,
});

async function createProductWithVariants(skus: string[]) {
  const product = await catalogApplication.create(context.company.id, {
    sku: `VAR-${randomUUID().slice(0, 6).toUpperCase()}`,
    name: "T-shirt",
    description: "",
    categoryId: null,
    unit: "piece",
    barcode: "",
    purchasePriceCents: 500,
    salePriceCents: 1_000,
    isService: false,
    imageUrls: [],
    minStock: "0",
    variants: skus.map((sku) => variant(sku)),
    initialStock: null,
  });
  const detail = await catalogApplication.getDetail(context.company.id, product.id);
  const idOf = (sku: string) => detail.variants.find((row) => row.sku === sku)!.id;
  return { product, idOf };
}

async function allVariants(productId: string) {
  return db.select().from(productVariants).where(eq(productVariants.productId, productId));
}

/** Stock line of the product whose first movement named `variantId`. */
async function stockWithVariant(productId: string, variantId: string, quantity: number) {
  await inventoryApplication.applyStandaloneMovement({
    companyId: context.company.id,
    productId,
    warehouseId: context.warehouseId,
    variantId,
    movementType: "IN",
    quantity,
    unitCostCents: 500,
  });
  const [item] = await db
    .select()
    .from(stockItems)
    .where(and(eq(stockItems.productId, productId), eq(stockItems.variantId, variantId)));
  return item;
}

describe("saving a product with variants", () => {
  it("keeps the variants and their ids when the product is saved again", async () => {
    const { product, idOf } = await createProductWithVariants(["S", "M"]);
    const before = { S: idOf("S"), M: idOf("M") };

    await catalogApplication.update(context.company.id, product.id, {
      name: "T-shirt (renamed)",
      variants: [variant("S", { barcode: "111" }), variant("M", { salePriceCents: 1_200 })],
    });

    const detail = await catalogApplication.getDetail(context.company.id, product.id);
    expect(detail.variants.map((row) => [row.sku, row.id])).toEqual([
      ["M", before.M],
      ["S", before.S],
    ]);
    expect(detail.variants.find((row) => row.sku === "S")!.barcode).toBe("111");
    expect(detail.variants.find((row) => row.sku === "M")!.salePriceCents).toBe(1_200);
  });

  it("leaves the variants alone when the save does not mention them", async () => {
    const { product, idOf } = await createProductWithVariants(["A"]);
    await catalogApplication.update(context.company.id, product.id, { salePriceCents: 2_000 });
    const detail = await catalogApplication.getDetail(context.company.id, product.id);
    expect(detail.variants.map((row) => row.id)).toEqual([idOf("A")]);
  });

  it("keeps the stock line and its movements attached to a variant", async () => {
    const { product, idOf } = await createProductWithVariants(["S", "M"]);
    const item = await stockWithVariant(product.id, idOf("S"), 7);

    await catalogApplication.update(context.company.id, product.id, {
      variants: [variant("S"), variant("M")],
    });

    const [after] = await db.select().from(stockItems).where(eq(stockItems.id, item.id));
    expect(after?.variantId).toBe(idOf("S"));
    expect(Number(after?.quantity)).toBe(7);
    const movements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.stockItemId, item.id));
    expect(movements).toHaveLength(1);
  });

  it("gives a new id to a new variant only", async () => {
    const { product, idOf } = await createProductWithVariants(["S"]);
    await catalogApplication.update(context.company.id, product.id, {
      variants: [variant("S"), variant("L")],
    });
    const detail = await catalogApplication.getDetail(context.company.id, product.id);
    const l = detail.variants.find((row) => row.sku === "L")!;
    expect(detail.variants.find((row) => row.sku === "S")!.id).toBe(idOf("S"));
    expect(l.id).not.toBe(idOf("S"));
  });

  it("withdraws a removed variant without deleting it, its stock or its history", async () => {
    const { product, idOf } = await createProductWithVariants(["S", "M"]);
    const item = await stockWithVariant(product.id, idOf("M"), 3);

    await catalogApplication.update(context.company.id, product.id, { variants: [variant("S")] });

    const detail = await catalogApplication.getDetail(context.company.id, product.id);
    expect(detail.variants.map((row) => row.sku)).toEqual(["S"]);

    const rows = await allVariants(product.id);
    const withdrawn = rows.find((row) => row.id === idOf("M"));
    expect(withdrawn?.isActive).toBe(false);
    const [stock] = await db.select().from(stockItems).where(eq(stockItems.id, item.id));
    expect(Number(stock?.quantity)).toBe(3);

    // Submitted again, it comes back with the same id.
    await catalogApplication.update(context.company.id, product.id, {
      variants: [variant("S"), variant("M")],
    });
    const back = await catalogApplication.getDetail(context.company.id, product.id);
    expect(back.variants.find((row) => row.sku === "M")!.id).toBe(idOf("M"));
  });

  it("no longer finds a withdrawn variant by its barcode", async () => {
    const barcode = `BC-${randomUUID().slice(0, 8)}`;
    const { product } = await createProductWithVariants([]);
    await catalogApplication.update(context.company.id, product.id, {
      variants: [variant("S", { barcode })],
    });
    expect((await catalogApplication.findByBarcode(context.company.id, barcode))?.id).toBe(
      product.id
    );
    await catalogApplication.update(context.company.id, product.id, { variants: [] });
    expect(await catalogApplication.findByBarcode(context.company.id, barcode)).toBeNull();
  });

  it("updates by id, including a SKU exchanged between two variants", async () => {
    const { product, idOf } = await createProductWithVariants(["S", "M"]);
    await catalogApplication.update(context.company.id, product.id, {
      variants: [variant("M", { id: idOf("S") }), variant("S", { id: idOf("M") })],
    });
    const rows = await allVariants(product.id);
    expect(rows.find((row) => row.id === idOf("S"))?.sku).toBe("M");
    expect(rows.find((row) => row.id === idOf("M"))?.sku).toBe("S");
  });

  it("refuses two variants with the same SKU, or an unknown id", async () => {
    const { product } = await createProductWithVariants(["S"]);
    await expect(
      catalogApplication.update(context.company.id, product.id, {
        variants: [variant("X"), variant("X")],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      catalogApplication.update(context.company.id, product.id, {
        variants: [variant("X", { id: randomUUID() })],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps sales pointing at the variant they sold", async () => {
    const { product, idOf } = await createProductWithVariants(["S", "M"]);
    await stockWithVariant(product.id, idOf("S"), 10);
    const invoice = await invoicingApplication.create(
      context.company,
      {
        partyId: customerId,
        warehouseId: context.warehouseId,
        lines: [{ productId: product.id, variantId: idOf("S"), quantity: 2, description: "S" }],
      },
      context.userId
    );
    await invoicingApplication.validate(context.company, invoice.id, context.userId);

    await catalogApplication.update(context.company.id, product.id, {
      variants: [variant("S", { barcode: "222" })],
    });

    const reloaded = await invoicingApplication.get(context.company.id, invoice.id);
    expect(reloaded.lines[0].variantId).toBe(idOf("S"));
    const rows = await allVariants(product.id);
    expect(rows.some((row) => row.id === idOf("S") && row.isActive)).toBe(true);
  });
});
