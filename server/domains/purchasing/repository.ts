/** Persistance des achats : commandes, réceptions, factures fournisseur. */

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import {
  goodsReceiptLines,
  goodsReceipts,
  parties,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoiceLines,
  supplierInvoices,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type SupplierInvoice,
} from "@shared/schema";
import { db, type Database } from "../../db";

export interface PurchaseOrderWithLines extends PurchaseOrder {
  lines: PurchaseOrderLine[];
  supplierName: string;
}

export interface GoodsReceiptWithLines extends GoodsReceipt {
  lines: GoodsReceiptLine[];
  supplierName: string;
}

export class PurchasingRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): PurchasingRepository {
    return new PurchasingRepository(tx);
  }

  async listOrders(
    companyId: string,
    options: {
      search?: string;
      status?: PurchaseOrder["status"] | null;
      supplierId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where = and(
      eq(purchaseOrders.companyId, companyId),
      options.status ? eq(purchaseOrders.status, options.status) : undefined,
      options.supplierId ? eq(purchaseOrders.supplierId, options.supplierId) : undefined,
      options.fromDate ? gte(purchaseOrders.date, options.fromDate) : undefined,
      options.toDate ? lte(purchaseOrders.date, options.toDate) : undefined,
      options.search
        ? sql`(${purchaseOrders.number} ilike ${`%${options.search}%`} or ${parties.name} ilike ${`%${options.search}%`})`
        : undefined
    );
    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({ order: purchaseOrders, supplierName: parties.name })
        .from(purchaseOrders)
        .innerJoin(parties, eq(parties.id, purchaseOrders.supplierId))
        .where(where)
        .orderBy(desc(purchaseOrders.date), desc(purchaseOrders.createdAt))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .innerJoin(parties, eq(parties.id, purchaseOrders.supplierId))
        .where(where),
    ]);
    return {
      items: rows.map((row) => ({ ...row.order, supplierName: row.supplierName })),
      total: countRow?.value ?? 0,
    };
  }

  async findOrder(companyId: string, orderId: string): Promise<PurchaseOrderWithLines | null> {
    const [row] = await this.database
      .select({ order: purchaseOrders, supplierName: parties.name })
      .from(purchaseOrders)
      .innerJoin(parties, eq(parties.id, purchaseOrders.supplierId))
      .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, orderId)))
      .limit(1);
    if (!row) return null;
    const lines = await this.database
      .select()
      .from(purchaseOrderLines)
      .where(
        and(eq(purchaseOrderLines.companyId, companyId), eq(purchaseOrderLines.orderId, orderId))
      )
      .orderBy(asc(purchaseOrderLines.position));
    return { ...row.order, lines, supplierName: row.supplierName };
  }

  async insertOrder(values: typeof purchaseOrders.$inferInsert): Promise<PurchaseOrder> {
    const [row] = await this.database.insert(purchaseOrders).values(values).returning();
    return row;
  }

  async replaceOrderLines(
    companyId: string,
    orderId: string,
    values: Omit<typeof purchaseOrderLines.$inferInsert, "companyId" | "orderId">[]
  ): Promise<void> {
    await this.database
      .delete(purchaseOrderLines)
      .where(
        and(eq(purchaseOrderLines.companyId, companyId), eq(purchaseOrderLines.orderId, orderId))
      );
    if (values.length === 0) return;
    await this.database
      .insert(purchaseOrderLines)
      .values(values.map((line) => ({ ...line, companyId, orderId })));
  }

  async updateOrder(
    companyId: string,
    orderId: string,
    patch: Partial<typeof purchaseOrders.$inferInsert>
  ): Promise<PurchaseOrder | null> {
    const [row] = await this.database
      .update(purchaseOrders)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, orderId)))
      .returning();
    return row ?? null;
  }

  /** Ajoute la quantité reçue à une ligne de commande, en base pour rester exact. */
  async addReceivedQuantity(companyId: string, lineId: string, quantity: string): Promise<void> {
    await this.database
      .update(purchaseOrderLines)
      .set({
        receivedQuantity: sql`${purchaseOrderLines.receivedQuantity} + ${quantity}::numeric`,
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseOrderLines.companyId, companyId), eq(purchaseOrderLines.id, lineId)));
  }

  async listReceipts(
    companyId: string,
    options: { purchaseOrderId?: string | null; limit?: number; offset?: number } = {}
  ) {
    const where = and(
      eq(goodsReceipts.companyId, companyId),
      options.purchaseOrderId
        ? eq(goodsReceipts.purchaseOrderId, options.purchaseOrderId)
        : undefined
    );
    const rows = await this.database
      .select({ receipt: goodsReceipts, supplierName: parties.name })
      .from(goodsReceipts)
      .innerJoin(parties, eq(parties.id, goodsReceipts.supplierId))
      .where(where)
      .orderBy(desc(goodsReceipts.date))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);
    return rows.map((row) => ({ ...row.receipt, supplierName: row.supplierName }));
  }

  async findReceipt(companyId: string, receiptId: string): Promise<GoodsReceiptWithLines | null> {
    const [row] = await this.database
      .select({ receipt: goodsReceipts, supplierName: parties.name })
      .from(goodsReceipts)
      .innerJoin(parties, eq(parties.id, goodsReceipts.supplierId))
      .where(and(eq(goodsReceipts.companyId, companyId), eq(goodsReceipts.id, receiptId)))
      .limit(1);
    if (!row) return null;
    const lines = await this.database
      .select()
      .from(goodsReceiptLines)
      .where(
        and(eq(goodsReceiptLines.companyId, companyId), eq(goodsReceiptLines.receiptId, receiptId))
      );
    return { ...row.receipt, lines, supplierName: row.supplierName };
  }

  async insertReceipt(values: typeof goodsReceipts.$inferInsert): Promise<GoodsReceipt> {
    const [row] = await this.database.insert(goodsReceipts).values(values).returning();
    return row;
  }

  async insertReceiptLines(
    values: (typeof goodsReceiptLines.$inferInsert)[]
  ): Promise<GoodsReceiptLine[]> {
    if (values.length === 0) return [];
    return this.database.insert(goodsReceiptLines).values(values).returning();
  }

  async listSupplierInvoices(
    companyId: string,
    options: {
      supplierId?: string | null;
      status?: SupplierInvoice["status"] | null;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where = and(
      eq(supplierInvoices.companyId, companyId),
      options.supplierId ? eq(supplierInvoices.supplierId, options.supplierId) : undefined,
      options.status ? eq(supplierInvoices.status, options.status) : undefined
    );
    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({ invoice: supplierInvoices, supplierName: parties.name })
        .from(supplierInvoices)
        .innerJoin(parties, eq(parties.id, supplierInvoices.supplierId))
        .where(where)
        .orderBy(desc(supplierInvoices.date))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(supplierInvoices)
        .where(where),
    ]);
    return {
      items: rows.map((row) => ({ ...row.invoice, supplierName: row.supplierName })),
      total: countRow?.value ?? 0,
    };
  }

  async insertSupplierInvoice(
    values: typeof supplierInvoices.$inferInsert
  ): Promise<SupplierInvoice> {
    const [row] = await this.database.insert(supplierInvoices).values(values).returning();
    return row;
  }

  async insertSupplierInvoiceLines(
    values: (typeof supplierInvoiceLines.$inferInsert)[]
  ): Promise<void> {
    if (values.length === 0) return;
    await this.database.insert(supplierInvoiceLines).values(values);
  }

  /** Total acheté sur une période — rapport achats [FR-RPT-1]. */
  async purchaseSummary(companyId: string, fromDate: string, toDate: string) {
    const [row] = await this.database
      .select({
        orderCount: sql<number>`count(*)::int`,
        totalHtCents: sql<number>`coalesce(sum(${purchaseOrders.totalHtCents}), 0)::int`,
        totalTtcCents: sql<number>`coalesce(sum(${purchaseOrders.totalTtcCents}), 0)::int`,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          gte(purchaseOrders.date, fromDate),
          lte(purchaseOrders.date, toDate)
        )
      );
    return {
      orderCount: row?.orderCount ?? 0,
      totalHtCents: row?.totalHtCents ?? 0,
      totalTtcCents: row?.totalTtcCents ?? 0,
    };
  }
}

export const purchasingRepository = new PurchasingRepository();
