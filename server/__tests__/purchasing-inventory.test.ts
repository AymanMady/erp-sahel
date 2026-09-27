/**
 * Purchasing ⇄ inventory invariants:
 * - a receipt never brings in more than what is left on the order, nor on a cancelled one;
 * - the average cost uses the price actually paid (after discounts);
 * - a movement never touches a product or a store of another company;
 * - a sale draws from the stock received with a lot number.
 * Failures are asserted on error `code`s, never on message text (messages are translated).
 */

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayInput } from "@shared/format";
import { stockItems } from "@shared/schema";
import { closeDatabase, db, runInTransaction } from "../db";
import { catalogApplication } from "../domains/catalog/application";
import { inventoryApplication } from "../domains/inventory/application";
import { invoicingApplication } from "../domains/invoicing/application";
import { partiesApplication } from "../domains/parties/application";
import { purchasingApplication } from "../domains/purchasing/application";
import { purchasingRepository } from "../domains/purchasing/repository";
import { createTestCompany, dropTestCompany, type TestContext } from "./helpers";

let context: TestContext;
let other: TestContext;
let supplierId: string;
let customerId: string;

/** A product with no stock at all, bought at 1 000 MRU by default. */
async function createEmptyProduct(target: TestContext = context, purchasePriceCents = 100_000) {
  return catalogApplication.create(
    target.company.id,
    {
      sku: `PI-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: "Purchased item",
      description: "",
      categoryId: null,
      unit: "piece",
      barcode: "",
      purchasePriceCents,
      salePriceCents: 300_000,
      isService: false,
      imageUrls: [],
      minStock: "0",
      variants: [],
      initialStock: null,
    },
    target.userId
  );
}

async function stockLines(productId: string) {
  return db
    .select()
    .from(stockItems)
    .where(and(eq(stockItems.companyId, context.company.id), eq(stockItems.productId, productId)));
}

async function orderOf(productId: string, quantity: number, unitPriceCents = 2_000) {
  return purchasingApplication.createOrder(
    context.company,
    { supplierId, lines: [{ productId, quantity, unitPriceCents }] },
    context.userId
  );
}

beforeAll(async () => {
  context = await createTestCompany("purch");
  other = await createTestCompany("purch-other");
  const supplier = await partiesApplication.create(
    context.company.id,
    { name: "Supplier", partyType: "SUPPLIER" },
    db
  );
  supplierId = supplier.id;
  const customer = await partiesApplication.create(
    context.company.id,
    { name: "Customer", partyType: "CUSTOMER" },
    db
  );
  customerId = customer.id;
});

afterAll(async () => {
  await dropTestCompany(context);
  await dropTestCompany(other);
  await closeDatabase();
});

describe("goods receipt", () => {
  it("refuses to receive more than what is left on the order", async () => {
    const product = await createEmptyProduct();
    const order = await orderOf(product.id, 10);
    const lineId = order.lines[0].id;

    await expect(
      purchasingApplication.createReceipt(
        context.company,
        {
          purchaseOrderId: order.id,
          lines: [{ purchaseOrderLineId: lineId, productId: product.id, quantity: 11 }],
        },
        context.userId
      )
    ).rejects.toMatchObject({ code: "RECEIPT_EXCEEDS_ORDER" });

    await purchasingApplication.createReceipt(
      context.company,
      {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: lineId, productId: product.id, quantity: 6 }],
      },
      context.userId
    );

    // 4 left: two lines of 3 on the same order line exceed it together.
    await expect(
      purchasingApplication.createReceipt(
        context.company,
        {
          purchaseOrderId: order.id,
          lines: [
            { purchaseOrderLineId: lineId, productId: product.id, quantity: 3 },
            { purchaseOrderLineId: lineId, productId: product.id, quantity: 3 },
          ],
        },
        context.userId
      )
    ).rejects.toMatchObject({ code: "RECEIPT_EXCEEDS_ORDER" });

    const refreshed = await purchasingApplication.getOrder(context.company.id, order.id);
    expect(refreshed.status).toBe("PARTIALLY_RECEIVED");
    expect(Number(refreshed.lines[0].receivedQuantity)).toBe(6);
    expect(Number((await stockLines(product.id))[0].quantity)).toBe(6);
  });

  it("refuses a line that is not on the order", async () => {
    const product = await createEmptyProduct();
    const stranger = await createEmptyProduct();
    const order = await orderOf(product.id, 5);
    await expect(
      purchasingApplication.createReceipt(
        context.company,
        { purchaseOrderId: order.id, lines: [{ productId: stranger.id, quantity: 1 }] },
        context.userId
      )
    ).rejects.toMatchObject({ code: "RECEIPT_LINE_NOT_ON_ORDER" });
  });

  it("refuses to receive a cancelled order", async () => {
    const product = await createEmptyProduct();
    const order = await orderOf(product.id, 5);
    await purchasingApplication.setOrderStatus(context.company.id, order.id, "CANCELLED");

    await expect(
      purchasingApplication.createReceipt(
        context.company,
        {
          purchaseOrderId: order.id,
          lines: [{ purchaseOrderLineId: order.lines[0].id, productId: product.id, quantity: 5 }],
        },
        context.userId
      )
    ).rejects.toMatchObject({ code: "PURCHASE_ORDER_CANCELLED" });
    expect(await stockLines(product.id)).toHaveLength(0);

    // A cancelled order cannot be brought back, nor marked received by hand.
    await expect(
      purchasingApplication.setOrderStatus(context.company.id, order.id, "ORDERED")
    ).rejects.toMatchObject({ code: "PURCHASE_ORDER_FROZEN" });
    await expect(
      purchasingApplication.setOrderStatus(context.company.id, order.id, "RECEIVED")
    ).rejects.toMatchObject({ code: "PURCHASE_ORDER_STATUS_FORBIDDEN" });
  });

  it("forbids changing the items of a partly received order", async () => {
    const product = await createEmptyProduct();
    const order = await orderOf(product.id, 10);
    await purchasingApplication.createReceipt(
      context.company,
      {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: order.lines[0].id, productId: product.id, quantity: 4 }],
      },
      context.userId
    );

    await expect(
      purchasingApplication.updateOrder(context.company, order.id, {
        lines: [{ productId: product.id, quantity: 12, unitPriceCents: 2_000 }],
      })
    ).rejects.toMatchObject({ code: "PURCHASE_ORDER_PARTIALLY_RECEIVED" });

    // Notes can still change, and the received quantity is kept.
    const updated = await purchasingApplication.updateOrder(context.company, order.id, {
      notes: "Rest next week",
    });
    expect(Number(updated.lines[0].receivedQuantity)).toBe(4);
  });
});

describe("purchase order totals", () => {
  it("recomputes the total when only the global discount changes", async () => {
    const product = await createEmptyProduct();
    const order = await orderOf(product.id, 10, 2_000);
    expect(order.totalCents).toBe(20_000);

    const updated = await purchasingApplication.updateOrder(context.company, order.id, {
      globalDiscountBp: 1_000,
    });
    expect(updated.totalCents).toBe(18_000);
    expect(updated.lines[0].totalCents).toBe(18_000);
  });

  it("prices a line without a price at the purchase price, not the sale price", async () => {
    const product = await createEmptyProduct(context, 70_000);
    const order = await purchasingApplication.createOrder(
      context.company,
      { supplierId, lines: [{ productId: product.id, quantity: 1 }] },
      context.userId
    );
    expect(order.totalCents).toBe(70_000);
  });

  it("counts only the orders sent to the supplier in the purchases total", async () => {
    const fresh = await createTestCompany("purch-sum");
    try {
      const supplier = await partiesApplication.create(
        fresh.company.id,
        { name: "S", partyType: "SUPPLIER" },
        db
      );
      const product = await createEmptyProduct(fresh);
      const make = () =>
        purchasingApplication.createOrder(
          fresh.company,
          {
            supplierId: supplier.id,
            lines: [{ productId: product.id, quantity: 1, unitPriceCents: 5_000 }],
          },
          fresh.userId
        );
      await make(); // stays a draft
      const cancelled = await make();
      await purchasingApplication.setOrderStatus(fresh.company.id, cancelled.id, "CANCELLED");
      const sent = await make();
      await purchasingApplication.setOrderStatus(fresh.company.id, sent.id, "ORDERED");

      const summary = await purchasingRepository.purchaseSummary(
        fresh.company.id,
        "2000-01-01",
        todayInput()
      );
      expect(summary).toEqual({ orderCount: 1, totalCents: 5_000 });
    } finally {
      await dropTestCompany(fresh);
    }
  });
});

describe("average cost", () => {
  it("uses the price after the line and order discounts", async () => {
    const product = await createEmptyProduct();
    // 10 × 2 000, −10 % on the line, −10 % on the order ⇒ 16 200 ⇒ 1 620 each.
    const order = await purchasingApplication.createOrder(
      context.company,
      {
        supplierId,
        globalDiscountBp: 1_000,
        lines: [{ productId: product.id, quantity: 10, unitPriceCents: 2_000, discountBp: 1_000 }],
      },
      context.userId
    );
    expect(order.totalCents).toBe(16_200);

    // An older screen sends the price before discount: the net price is used instead.
    const receipt = await purchasingApplication.createReceipt(
      context.company,
      {
        purchaseOrderId: order.id,
        lines: [
          {
            purchaseOrderLineId: order.lines[0].id,
            productId: product.id,
            quantity: 5,
            unitCostCents: 2_000,
          },
        ],
      },
      context.userId
    );
    expect(receipt.lines[0].unitCostCents).toBe(1_620);
    // No cost sent at all: same net price.
    await purchasingApplication.createReceipt(
      context.company,
      {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: order.lines[0].id, productId: product.id, quantity: 5 }],
      },
      context.userId
    );

    const [line] = await stockLines(product.id);
    expect(Number(line.quantity)).toBe(10);
    expect(line.averageCostCents).toBe(1_620);
  });

  it("falls back to the purchase price when a receipt has no cost", async () => {
    const product = await createEmptyProduct(context, 80_000);
    await purchasingApplication.createReceipt(
      context.company,
      { supplierId, lines: [{ productId: product.id, quantity: 2 }] },
      context.userId
    );
    const [line] = await stockLines(product.id);
    expect(line.averageCostCents).toBe(80_000);
  });

  it("takes the incoming cost when the stock was negative", async () => {
    const product = await createEmptyProduct();
    await inventoryApplication.applyStandaloneMovement({
      companyId: context.company.id,
      productId: product.id,
      warehouseId: context.warehouseId,
      movementType: "OUT",
      quantity: 5,
      allowNegative: true,
    });
    await inventoryApplication.applyStandaloneMovement({
      companyId: context.company.id,
      productId: product.id,
      warehouseId: context.warehouseId,
      movementType: "IN",
      quantity: 10,
      unitCostCents: 500,
    });
    const [line] = await stockLines(product.id);
    expect(Number(line.quantity)).toBe(5);
    expect(line.averageCostCents).toBe(500);
  });
});

describe("company isolation of stock movements", () => {
  it("refuses a product of another company", async () => {
    const foreign = await createEmptyProduct(other);
    await expect(
      inventoryApplication.applyStandaloneMovement({
        companyId: context.company.id,
        productId: foreign.id,
        warehouseId: context.warehouseId,
        movementType: "IN",
        quantity: 3,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a store of another company, also in a transfer", async () => {
    const product = await createEmptyProduct();
    await expect(
      inventoryApplication.applyStandaloneMovement({
        companyId: context.company.id,
        productId: product.id,
        warehouseId: other.warehouseId,
        movementType: "IN",
        quantity: 3,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await inventoryApplication.applyStandaloneMovement({
      companyId: context.company.id,
      productId: product.id,
      warehouseId: context.warehouseId,
      movementType: "IN",
      quantity: 3,
    });
    await expect(
      inventoryApplication.transfer({
        companyId: context.company.id,
        productId: product.id,
        fromWarehouseId: context.warehouseId,
        toWarehouseId: other.warehouseId,
        quantity: 1,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Nothing left the first store.
    expect(Number((await stockLines(product.id))[0].quantity)).toBe(3);
  });
});

describe("lots", () => {
  it("lets a sale use the stock received with a lot number, oldest lot first", async () => {
    const product = await createEmptyProduct();
    await purchasingApplication.createReceipt(
      context.company,
      {
        supplierId,
        warehouseId: context.warehouseId,
        lines: [{ productId: product.id, quantity: 4, lotNumber: "L1", unitCostCents: 1_000 }],
      },
      context.userId
    );
    await purchasingApplication.createReceipt(
      context.company,
      {
        supplierId,
        warehouseId: context.warehouseId,
        lines: [{ productId: product.id, quantity: 4, lotNumber: "L2", unitCostCents: 1_000 }],
      },
      context.userId
    );

    await invoicingApplication.create(
      context.company,
      {
        partyId: customerId,
        warehouseId: context.warehouseId,
        lines: [{ productId: product.id, quantity: 6 }],
        validate: true,
      },
      context.userId
    );

    const byLot = new Map(
      (await stockLines(product.id)).map((line) => [line.lotNumber, Number(line.quantity)])
    );
    expect(byLot.get("L1")).toBe(0);
    expect(byLot.get("L2")).toBe(2);

    await expect(
      invoicingApplication.create(
        context.company,
        {
          partyId: customerId,
          warehouseId: context.warehouseId,
          lines: [{ productId: product.id, quantity: 3 }],
          validate: true,
        },
        context.userId
      )
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });
});

describe("supplier invoice payments", () => {
  it("tracks the amount paid and refuses to pay more than owed", async () => {
    const product = await createEmptyProduct();
    const invoice = await purchasingApplication.createSupplierInvoice(context.company, {
      supplierId,
      lines: [{ productId: product.id, quantity: 1, unitPriceCents: 10_000 }],
    });

    const partial = await runInTransaction((tx) =>
      purchasingApplication.applySupplierPayment(tx, context.company.id, invoice.id, 4_000)
    );
    expect(partial.status).toBe("PARTIALLY_PAID");
    expect(
      await purchasingApplication.supplierInvoiceAmountDue(context.company.id, invoice.id)
    ).toBe(6_000);

    await expect(
      runInTransaction((tx) =>
        purchasingApplication.applySupplierPayment(tx, context.company.id, invoice.id, 7_000)
      )
    ).rejects.toMatchObject({ code: "OVERPAYMENT" });

    const paid = await runInTransaction((tx) =>
      purchasingApplication.applySupplierPayment(tx, context.company.id, invoice.id, 6_000)
    );
    expect(paid.status).toBe("PAID");
    expect(paid.paidAmountCents).toBe(10_000);
  });
});
