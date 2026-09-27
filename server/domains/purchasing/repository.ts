/** Purchasing persistence: orders, goods receipts, supplier invoices. */

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  goodsReceiptLines,
  goodsReceipts,
  parties,
  products,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoiceLines,
  supplierInvoices,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type SupplierInvoice,
  type SupplierInvoiceLine,
} from "@shared/schema";
import { db, type Database } from "../../db";

export interface PurchaseOrderWithLines extends PurchaseOrder {
  lines: PurchaseOrderLine[];
  supplierName: string;
}

export interface GoodsReceiptWithLines extends GoodsReceipt {
  lines: (GoodsReceiptLine & { productName: string; productSku: string })[];
  supplierName: string;
  purchaseOrderNumber: string | null;
}

export interface SupplierInvoiceDetail extends SupplierInvoice {
  lines: SupplierInvoiceLine[];
  supplierName: string;
  purchaseOrderNumber: string | null;
  receiptNumber: string | null;
}

/** Orders that count as purchases: sent to the supplier, whether received or not. */
const COUNTED_ORDER_STATUSES: readonly PurchaseOrder["status"][] = [
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
];

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

  /**
   * Updates the status only when the order is still in one of `fromStatuses` — checked
   * by the database, so a concurrent receipt or cancellation cannot be overwritten.
   */
  async updateOrderStatusIf(
    companyId: string,
    orderId: string,
    status: PurchaseOrder["status"],
    fromStatuses: readonly PurchaseOrder["status"][]
  ): Promise<PurchaseOrder | null> {
    const [row] = await this.database
      .update(purchaseOrders)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          eq(purchaseOrders.id, orderId),
          inArray(purchaseOrders.status, [...fromStatuses])
        )
      )
      .returning();
    return row ?? null;
  }

  /** Locks the order until the end of the transaction (receipt against cancellation). */
  async lockOrder(companyId: string, orderId: string): Promise<void> {
    await this.database
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, orderId)))
      .for("update");
  }

  async updateOrderLineTotal(companyId: string, lineId: string, totalCents: number): Promise<void> {
    await this.database
      .update(purchaseOrderLines)
      .set({ totalCents, updatedAt: new Date() })
      .where(and(eq(purchaseOrderLines.companyId, companyId), eq(purchaseOrderLines.id, lineId)));
  }

  /**
   * Adds the received quantity to an order line, in the database to stay exact.
   * Refused (returns `false`) when it would go beyond the ordered quantity: the check
   * is part of the update, so two receipts at the same time cannot both pass.
   */
  async addReceivedQuantity(companyId: string, lineId: string, quantity: string): Promise<boolean> {
    const rows = await this.database
      .update(purchaseOrderLines)
      .set({
        receivedQuantity: sql`${purchaseOrderLines.receivedQuantity} + ${quantity}::numeric`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseOrderLines.companyId, companyId),
          eq(purchaseOrderLines.id, lineId),
          sql`${purchaseOrderLines.receivedQuantity} + ${quantity}::numeric <= ${purchaseOrderLines.quantity}`
        )
      )
      .returning({ id: purchaseOrderLines.id });
    return rows.length > 0;
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
    const [lines, [order]] = await Promise.all([
      this.database
        .select({ line: goodsReceiptLines, productName: products.name, productSku: products.sku })
        .from(goodsReceiptLines)
        .leftJoin(products, eq(products.id, goodsReceiptLines.productId))
        .where(
          and(
            eq(goodsReceiptLines.companyId, companyId),
            eq(goodsReceiptLines.receiptId, receiptId)
          )
        ),
      row.receipt.purchaseOrderId
        ? this.database
            .select({ number: purchaseOrders.number })
            .from(purchaseOrders)
            .where(eq(purchaseOrders.id, row.receipt.purchaseOrderId))
            .limit(1)
        : Promise.resolve([]),
    ]);
    return {
      ...row.receipt,
      lines: lines.map((entry) => ({
        ...entry.line,
        productName: entry.productName ?? "",
        productSku: entry.productSku ?? "",
      })),
      supplierName: row.supplierName,
      purchaseOrderNumber: order?.number ?? null,
    };
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

  async findSupplierInvoice(companyId: string, invoiceId: string): Promise<SupplierInvoice | null> {
    const [row] = await this.database
      .select()
      .from(supplierInvoices)
      .where(and(eq(supplierInvoices.companyId, companyId), eq(supplierInvoices.id, invoiceId)))
      .limit(1);
    return row ?? null;
  }

  /** Supplier invoice with its lines and the numbers of the order and receipt it comes from. */
  async findSupplierInvoiceDetail(
    companyId: string,
    invoiceId: string
  ): Promise<SupplierInvoiceDetail | null> {
    const [row] = await this.database
      .select({ invoice: supplierInvoices, supplierName: parties.name })
      .from(supplierInvoices)
      .innerJoin(parties, eq(parties.id, supplierInvoices.supplierId))
      .where(and(eq(supplierInvoices.companyId, companyId), eq(supplierInvoices.id, invoiceId)))
      .limit(1);
    if (!row) return null;
    const [lines, [order], [receipt]] = await Promise.all([
      this.database
        .select()
        .from(supplierInvoiceLines)
        .where(
          and(
            eq(supplierInvoiceLines.companyId, companyId),
            eq(supplierInvoiceLines.invoiceId, invoiceId)
          )
        )
        .orderBy(asc(supplierInvoiceLines.position)),
      row.invoice.purchaseOrderId
        ? this.database
            .select({ number: purchaseOrders.number })
            .from(purchaseOrders)
            .where(eq(purchaseOrders.id, row.invoice.purchaseOrderId))
            .limit(1)
        : Promise.resolve([]),
      row.invoice.receiptId
        ? this.database
            .select({ number: goodsReceipts.number })
            .from(goodsReceipts)
            .where(eq(goodsReceipts.id, row.invoice.receiptId))
            .limit(1)
        : Promise.resolve([]),
    ]);
    return {
      ...row.invoice,
      lines,
      supplierName: row.supplierName,
      purchaseOrderNumber: order?.number ?? null,
      receiptNumber: receipt?.number ?? null,
    };
  }

  /**
   * Increments the paid amount **in the database** (`paid + delta`), not from a value
   * read beforehand: two simultaneous payments on the same invoice stay consistent.
   */
  async addSupplierPaidAmount(
    companyId: string,
    invoiceId: string,
    deltaCents: number
  ): Promise<SupplierInvoice | null> {
    const [row] = await this.database
      .update(supplierInvoices)
      .set({
        paidAmountCents: sql`${supplierInvoices.paidAmountCents} + ${deltaCents}`,
        updatedAt: new Date(),
      })
      .where(and(eq(supplierInvoices.companyId, companyId), eq(supplierInvoices.id, invoiceId)))
      .returning();
    return row ?? null;
  }

  async updateSupplierInvoice(
    companyId: string,
    invoiceId: string,
    patch: Partial<typeof supplierInvoices.$inferInsert>
  ): Promise<SupplierInvoice | null> {
    const [row] = await this.database
      .update(supplierInvoices)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(supplierInvoices.companyId, companyId), eq(supplierInvoices.id, invoiceId)))
      .returning();
    return row ?? null;
  }

  async insertSupplierInvoiceLines(
    values: (typeof supplierInvoiceLines.$inferInsert)[]
  ): Promise<void> {
    if (values.length === 0) return;
    await this.database.insert(supplierInvoiceLines).values(values);
  }

  /** Total purchased over a period — purchasing report [FR-RPT-1]. */
  async purchaseSummary(companyId: string, fromDate: string, toDate: string) {
    const [row] = await this.database
      .select({
        orderCount: sql<number>`count(*)::int`,
        totalCents: sql<number>`coalesce(sum(${purchaseOrders.totalCents}), 0)::bigint`,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          // Drafts and cancelled orders were never bought.
          inArray(purchaseOrders.status, [...COUNTED_ORDER_STATUSES]),
          gte(purchaseOrders.date, fromDate),
          lte(purchaseOrders.date, toDate)
        )
      );
    return {
      orderCount: row?.orderCount ?? 0,
      totalCents: row?.totalCents ?? 0,
    };
  }
}

export const purchasingRepository = new PurchasingRepository();
