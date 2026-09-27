/**
 * Read-only aggregates behind the reports ([FR-RPT-1] to [FR-RPT-3]).
 *
 * Reports own no table and never write: these queries only **read** the documents of
 * the owning domains (invoices, credit notes, stock movements, purchase orders) to add
 * them up. Every money sum is cast to `bigint` — an `int` would overflow above
 * 21 474 836 MRU.
 *
 * Returns are counted against the invoice they belong to (the invoice keeps
 * `credited_amount_cents`); a fully returned invoice is cancelled, so it drops out of
 * every figure below — sales, cost and best sellers alike.
 */

import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";

import {
  creditNoteLines,
  creditNotes,
  purchaseOrders,
  salesInvoiceLines,
  salesInvoices,
  stockMovements,
} from "@shared/schema";
import { db, type Database } from "../../db";

/** Invoices that count as sales: validated, whether paid or not. */
const SOLD_STATUSES = ["VALIDATED", "PARTIALLY_PAID", "PAID"] as const;

export class ReportsRepository {
  constructor(private readonly database: Database = db) {}

  private soldInPeriod(companyId: string, fromDate: string, toDate: string) {
    return and(
      eq(salesInvoices.companyId, companyId),
      gte(salesInvoices.date, fromDate),
      lte(salesInvoices.date, toDate),
      inArray(salesInvoices.status, [...SOLD_STATUSES])
    );
  }

  /** Net sales per day (invoiced minus returned), for the charts. */
  async dailyNetSales(companyId: string, fromDate: string, toDate: string) {
    return this.database
      .select({
        date: salesInvoices.date,
        totalCents: sql<number>`coalesce(sum(${salesInvoices.totalCents} - ${salesInvoices.creditedAmountCents}), 0)::bigint`,
        invoiceCount: sql<number>`count(*)::int`,
      })
      .from(salesInvoices)
      .where(this.soldInPeriod(companyId, fromDate, toDate))
      .groupBy(salesInvoices.date)
      .orderBy(asc(salesInvoices.date));
  }

  /**
   * What the goods sold cost the shop: quantity × unit cost recorded on each stock exit
   * of the period's sales, minus the cost of the goods customers brought back.
   */
  async costOfGoodsSold(companyId: string, fromDate: string, toDate: string): Promise<number> {
    const movementCost = sql`coalesce(sum(round(${stockMovements.quantity} * ${stockMovements.unitCostCents})), 0)::bigint`;

    const [sold] = await this.database
      .select({ value: sql<number>`${movementCost}` })
      .from(stockMovements)
      .innerJoin(salesInvoices, eq(salesInvoices.id, stockMovements.originId))
      .where(
        and(
          eq(stockMovements.companyId, companyId),
          inArray(stockMovements.originType, ["sales_invoice", "pos_ticket"]),
          eq(stockMovements.direction, "OUT"),
          this.soldInPeriod(companyId, fromDate, toDate)
        )
      );

    const [returned] = await this.database
      .select({ value: sql<number>`${movementCost}` })
      .from(stockMovements)
      .innerJoin(creditNotes, eq(creditNotes.id, stockMovements.originId))
      .innerJoin(salesInvoices, eq(salesInvoices.id, creditNotes.invoiceId))
      .where(
        and(
          eq(stockMovements.companyId, companyId),
          eq(stockMovements.originType, "credit_note"),
          eq(stockMovements.direction, "IN"),
          eq(creditNotes.status, "VALIDATED"),
          this.soldInPeriod(companyId, fromDate, toDate)
        )
      );

    return (sold?.value ?? 0) - (returned?.value ?? 0);
  }

  /** Best-selling items over a period, returned quantities taken off [FR-RPT-3]. */
  async topProducts(companyId: string, fromDate: string, toDate: string, limit = 10) {
    const returned = this.database
      .select({
        invoiceLineId: creditNoteLines.invoiceLineId,
        quantity: sql<string>`sum(${creditNoteLines.quantity})`.as("returned_quantity"),
        totalCents: sql<number>`sum(${creditNoteLines.totalCents})`.as("returned_cents"),
      })
      .from(creditNoteLines)
      .innerJoin(creditNotes, eq(creditNotes.id, creditNoteLines.creditNoteId))
      .where(and(eq(creditNoteLines.companyId, companyId), eq(creditNotes.status, "VALIDATED")))
      .groupBy(creditNoteLines.invoiceLineId)
      .as("returned");

    const netQuantity = sql`coalesce(sum(${salesInvoiceLines.quantity} - coalesce(${returned.quantity}, 0)), 0)`;
    const netRevenue = sql`coalesce(sum(${salesInvoiceLines.totalCents} - coalesce(${returned.totalCents}, 0)), 0)`;

    return this.database
      .select({
        productId: salesInvoiceLines.productId,
        productSku: salesInvoiceLines.productSku,
        description: salesInvoiceLines.description,
        quantity: sql<string>`${netQuantity}`,
        revenueCents: sql<number>`${netRevenue}::bigint`,
      })
      .from(salesInvoiceLines)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.invoiceId))
      .leftJoin(returned, eq(returned.invoiceLineId, salesInvoiceLines.id))
      .where(
        and(
          eq(salesInvoiceLines.companyId, companyId),
          this.soldInPeriod(companyId, fromDate, toDate)
        )
      )
      .groupBy(
        salesInvoiceLines.productId,
        salesInvoiceLines.productSku,
        salesInvoiceLines.description
      )
      .having(sql`${netQuantity} > 0`)
      .orderBy(desc(netRevenue))
      .limit(limit);
  }

  /** Purchases actually ordered over a period: drafts and cancelled orders left out. */
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
          gte(purchaseOrders.date, fromDate),
          lte(purchaseOrders.date, toDate),
          notInArray(purchaseOrders.status, ["DRAFT", "CANCELLED"])
        )
      );
    return {
      orderCount: row?.orderCount ?? 0,
      totalCents: row?.totalCents ?? 0,
    };
  }
}

export const reportsRepository = new ReportsRepository();
