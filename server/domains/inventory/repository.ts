/**
 * Inventory persistence. **Only this repository writes `stock_items` and
 * `stock_movements`**: this architectural invariant guarantees that no domain bypasses
 * the movement ledger ([FR-STK-3], `docs/ARCHITECTURE.md` §3).
 */

import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import {
  products,
  stockItems,
  stockLocations,
  stockMovements,
  warehouses,
  type StockItem,
  type StockMovement,
} from "@shared/schema";
import { db, type Database } from "../../db";
import { TenantRepository } from "../../shared/db/tenant-repository";

export const warehousesRepository = new TenantRepository(warehouses, [
  warehouses.code,
  warehouses.name,
]);

export const stockLocationsRepository = new TenantRepository(stockLocations, [
  stockLocations.code,
  stockLocations.name,
  stockLocations.zone,
]);

/** Stock line enriched with its product — the shape expected by screens and the POS snapshot. */
export interface StockRow extends StockItem {
  productSku: string;
  productName: string;
  productUnit: string;
  warehouseName: string;
  minStock: string;
}

export class InventoryRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): InventoryRepository {
    return new InventoryRepository(tx);
  }

  /**
   * Returns the stock line for the combination of axes, creating it if needed.
   * `ON CONFLICT DO UPDATE` rather than a `SELECT` followed by an `INSERT`: two
   * concurrent sales of the same item cannot create two competing lines.
   */
  async ensureStockItem(input: {
    companyId: string;
    productId: string;
    warehouseId: string;
    variantId?: string | null;
    locationId?: string | null;
    lotNumber?: string;
  }): Promise<StockItem> {
    const [row] = await this.database
      .insert(stockItems)
      .values({
        companyId: input.companyId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        variantId: input.variantId ?? null,
        locationId: input.locationId ?? null,
        lotNumber: input.lotNumber ?? "",
      })
      .onConflictDoUpdate({
        target: [
          stockItems.companyId,
          stockItems.productId,
          stockItems.warehouseId,
          stockItems.lotNumber,
        ],
        set: { updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  /**
   * Applies a delta to the balance and returns the updated line.
   * The computation is done **by the database** (`quantity + delta`): no
   * read-modify-write on the Node side, so no lost increment between two transactions
   * ([FR-STK-4]).
   */
  async applyDelta(input: {
    companyId: string;
    stockItemId: string;
    deltaQuantity: string;
    averageCostCents?: number | null;
  }): Promise<StockItem> {
    const [row] = await this.database
      .update(stockItems)
      .set({
        quantity: sql`${stockItems.quantity} + ${input.deltaQuantity}::numeric`,
        ...(input.averageCostCents != null ? { averageCostCents: input.averageCostCents } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(stockItems.companyId, input.companyId), eq(stockItems.id, input.stockItemId)))
      .returning();
    return row;
  }

  async insertMovement(values: typeof stockMovements.$inferInsert): Promise<StockMovement> {
    const [row] = await this.database.insert(stockMovements).values(values).returning();
    return row;
  }

  async findStockItem(
    companyId: string,
    criteria: { productId: string; warehouseId: string; lotNumber?: string }
  ): Promise<StockItem | null> {
    const [row] = await this.database
      .select()
      .from(stockItems)
      .where(
        and(
          eq(stockItems.companyId, companyId),
          eq(stockItems.productId, criteria.productId),
          eq(stockItems.warehouseId, criteria.warehouseId),
          eq(stockItems.lotNumber, criteria.lotNumber ?? "")
        )
      )
      .limit(1);
    return row ?? null;
  }

  /** Available quantity of a product, across all warehouses or for a given one. */
  async availableQuantity(
    companyId: string,
    productId: string,
    warehouseId?: string | null
  ): Promise<number> {
    const [row] = await this.database
      .select({ value: sql<string>`coalesce(sum(${stockItems.quantity}), 0)` })
      .from(stockItems)
      .where(
        and(
          eq(stockItems.companyId, companyId),
          eq(stockItems.productId, productId),
          warehouseId ? eq(stockItems.warehouseId, warehouseId) : undefined
        )
      );
    return Number.parseFloat(row?.value ?? "0");
  }

  /** Balances per product — feeds the "Stock" column of the catalog and the POS. */
  async quantitiesByProduct(companyId: string, productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.database
      .select({
        productId: stockItems.productId,
        total: sql<string>`coalesce(sum(${stockItems.quantity}), 0)`,
      })
      .from(stockItems)
      .where(and(eq(stockItems.companyId, companyId), inArray(stockItems.productId, productIds)))
      .groupBy(stockItems.productId);
    return new Map(rows.map((row) => [row.productId, Number.parseFloat(row.total)]));
  }

  async listStock(
    companyId: string,
    options: {
      warehouseId?: string | null;
      productId?: string | null;
      search?: string;
      lowStockOnly?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ items: StockRow[]; total: number }> {
    const conditions: (SQL | undefined)[] = [
      eq(stockItems.companyId, companyId),
      options.warehouseId ? eq(stockItems.warehouseId, options.warehouseId) : undefined,
      options.productId ? eq(stockItems.productId, options.productId) : undefined,
      options.search
        ? sql`(${products.name} ilike ${`%${options.search}%`} or ${products.sku} ilike ${`%${options.search}%`} or ${products.barcode} ilike ${`%${options.search}%`})`
        : undefined,
      options.lowStockOnly ? sql`${stockItems.quantity} <= ${products.minStock}` : undefined,
    ];
    const where = and(...conditions.filter(Boolean));

    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({
          item: stockItems,
          productSku: products.sku,
          productName: products.name,
          productUnit: products.unit,
          minStock: products.minStock,
          warehouseName: warehouses.name,
        })
        .from(stockItems)
        .innerJoin(products, eq(products.id, stockItems.productId))
        .innerJoin(warehouses, eq(warehouses.id, stockItems.warehouseId))
        .where(where)
        .orderBy(asc(products.name))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(stockItems)
        .innerJoin(products, eq(products.id, stockItems.productId))
        .where(where),
    ]);

    return {
      items: rows.map((row) => ({
        ...row.item,
        productSku: row.productSku,
        productName: row.productName,
        productUnit: row.productUnit,
        minStock: row.minStock,
        warehouseName: row.warehouseName,
      })),
      total: countRow?.value ?? 0,
    };
  }

  async listMovements(
    companyId: string,
    options: {
      productId?: string | null;
      warehouseId?: string | null;
      originType?: string | null;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where = and(
      eq(stockMovements.companyId, companyId),
      options.productId ? eq(stockMovements.productId, options.productId) : undefined,
      options.warehouseId ? eq(stockMovements.warehouseId, options.warehouseId) : undefined,
      options.originType ? eq(stockMovements.originType, options.originType as never) : undefined
    );

    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({
          movement: stockMovements,
          productSku: products.sku,
          productName: products.name,
          warehouseName: warehouses.name,
        })
        .from(stockMovements)
        .innerJoin(products, eq(products.id, stockMovements.productId))
        .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
        .where(where)
        .orderBy(desc(stockMovements.createdAt))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(stockMovements)
        .where(where),
    ]);

    return {
      items: rows.map((row) => ({
        ...row.movement,
        productSku: row.productSku,
        productName: row.productName,
        warehouseName: row.warehouseName,
      })),
      total: countRow?.value ?? 0,
    };
  }

  /** Stock valuation at weighted average cost [FR-RPT-1]. */
  async valuation(companyId: string, warehouseId?: string | null) {
    const [row] = await this.database
      .select({
        totalQuantity: sql<string>`coalesce(sum(${stockItems.quantity}), 0)`,
        totalValueCents: sql<number>`coalesce(sum(${stockItems.quantity} * ${stockItems.averageCostCents}), 0)::bigint`,
        skuCount: sql<number>`count(distinct ${stockItems.productId})::int`,
      })
      .from(stockItems)
      .where(
        and(
          eq(stockItems.companyId, companyId),
          warehouseId ? eq(stockItems.warehouseId, warehouseId) : undefined
        )
      );
    return {
      totalQuantity: Number.parseFloat(row?.totalQuantity ?? "0"),
      totalValueCents: Math.round(Number(row?.totalValueCents ?? 0)),
      skuCount: row?.skuCount ?? 0,
    };
  }

  /** Products below the alert threshold [FR-STK-5]. */
  async lowStock(companyId: string, limit = 20) {
    return this.database
      .select({
        productId: products.id,
        sku: products.sku,
        name: products.name,
        minStock: products.minStock,
        quantity: sql<string>`coalesce(sum(${stockItems.quantity}), 0)`,
      })
      .from(products)
      .leftJoin(stockItems, eq(stockItems.productId, products.id))
      .where(
        and(
          eq(products.companyId, companyId),
          eq(products.isActive, true),
          eq(products.isService, false),
          sql`${products.minStock} > 0`
        )
      )
      .groupBy(products.id, products.sku, products.name, products.minStock)
      .having(sql`coalesce(sum(${stockItems.quantity}), 0) <= ${products.minStock}`)
      .limit(limit);
  }
}

export const inventoryRepository = new InventoryRepository();
