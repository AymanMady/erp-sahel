/** Persistance des devis et commandes de vente. */

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import {
  parties,
  quoteLines,
  quotes,
  salesOrderLines,
  salesOrders,
  type Quote,
  type QuoteLine,
  type SalesOrder,
  type SalesOrderLine,
} from "@shared/schema";
import { db, type Database } from "../../db";

export interface QuoteWithLines extends Quote {
  lines: QuoteLine[];
  partyName: string;
}

export interface SalesOrderWithLines extends SalesOrder {
  lines: SalesOrderLine[];
  partyName: string;
}

export class SalesRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): SalesRepository {
    return new SalesRepository(tx);
  }

  async listQuotes(
    companyId: string,
    options: {
      search?: string;
      status?: Quote["status"] | null;
      partyId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where = and(
      eq(quotes.companyId, companyId),
      options.status ? eq(quotes.status, options.status) : undefined,
      options.partyId ? eq(quotes.partyId, options.partyId) : undefined,
      options.fromDate ? gte(quotes.date, options.fromDate) : undefined,
      options.toDate ? lte(quotes.date, options.toDate) : undefined,
      options.search
        ? sql`(${quotes.number} ilike ${`%${options.search}%`} or ${parties.name} ilike ${`%${options.search}%`})`
        : undefined
    );
    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({ quote: quotes, partyName: parties.name })
        .from(quotes)
        .innerJoin(parties, eq(parties.id, quotes.partyId))
        .where(where)
        .orderBy(desc(quotes.date), desc(quotes.createdAt))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(quotes)
        .innerJoin(parties, eq(parties.id, quotes.partyId))
        .where(where),
    ]);
    return {
      items: rows.map((row) => ({ ...row.quote, partyName: row.partyName })),
      total: countRow?.value ?? 0,
    };
  }

  async findQuote(companyId: string, quoteId: string): Promise<QuoteWithLines | null> {
    const [row] = await this.database
      .select({ quote: quotes, partyName: parties.name })
      .from(quotes)
      .innerJoin(parties, eq(parties.id, quotes.partyId))
      .where(and(eq(quotes.companyId, companyId), eq(quotes.id, quoteId)))
      .limit(1);
    if (!row) return null;
    const lines = await this.database
      .select()
      .from(quoteLines)
      .where(and(eq(quoteLines.companyId, companyId), eq(quoteLines.quoteId, quoteId)))
      .orderBy(asc(quoteLines.position));
    return { ...row.quote, lines, partyName: row.partyName };
  }

  async findQuoteByClientUuid(companyId: string, clientUuid: string): Promise<Quote | null> {
    const [row] = await this.database
      .select()
      .from(quotes)
      .where(and(eq(quotes.companyId, companyId), eq(quotes.clientUuid, clientUuid)))
      .limit(1);
    return row ?? null;
  }

  async insertQuote(values: typeof quotes.$inferInsert): Promise<Quote> {
    const [row] = await this.database.insert(quotes).values(values).returning();
    return row;
  }

  async replaceQuoteLines(
    companyId: string,
    quoteId: string,
    values: Omit<typeof quoteLines.$inferInsert, "companyId" | "quoteId">[]
  ): Promise<void> {
    await this.database
      .delete(quoteLines)
      .where(and(eq(quoteLines.companyId, companyId), eq(quoteLines.quoteId, quoteId)));
    if (values.length === 0) return;
    await this.database
      .insert(quoteLines)
      .values(values.map((line) => ({ ...line, companyId, quoteId })));
  }

  async updateQuote(
    companyId: string,
    quoteId: string,
    patch: Partial<typeof quotes.$inferInsert>
  ): Promise<Quote | null> {
    const [row] = await this.database
      .update(quotes)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(quotes.companyId, companyId), eq(quotes.id, quoteId)))
      .returning();
    return row ?? null;
  }

  async listOrders(
    companyId: string,
    options: {
      search?: string;
      status?: SalesOrder["status"] | null;
      partyId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where = and(
      eq(salesOrders.companyId, companyId),
      options.status ? eq(salesOrders.status, options.status) : undefined,
      options.partyId ? eq(salesOrders.partyId, options.partyId) : undefined,
      options.fromDate ? gte(salesOrders.date, options.fromDate) : undefined,
      options.toDate ? lte(salesOrders.date, options.toDate) : undefined,
      options.search
        ? sql`(${salesOrders.number} ilike ${`%${options.search}%`} or ${parties.name} ilike ${`%${options.search}%`})`
        : undefined
    );
    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({ order: salesOrders, partyName: parties.name })
        .from(salesOrders)
        .innerJoin(parties, eq(parties.id, salesOrders.partyId))
        .where(where)
        .orderBy(desc(salesOrders.date), desc(salesOrders.createdAt))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(salesOrders)
        .innerJoin(parties, eq(parties.id, salesOrders.partyId))
        .where(where),
    ]);
    return {
      items: rows.map((row) => ({ ...row.order, partyName: row.partyName })),
      total: countRow?.value ?? 0,
    };
  }

  async findOrder(companyId: string, orderId: string): Promise<SalesOrderWithLines | null> {
    const [row] = await this.database
      .select({ order: salesOrders, partyName: parties.name })
      .from(salesOrders)
      .innerJoin(parties, eq(parties.id, salesOrders.partyId))
      .where(and(eq(salesOrders.companyId, companyId), eq(salesOrders.id, orderId)))
      .limit(1);
    if (!row) return null;
    const lines = await this.database
      .select()
      .from(salesOrderLines)
      .where(and(eq(salesOrderLines.companyId, companyId), eq(salesOrderLines.orderId, orderId)))
      .orderBy(asc(salesOrderLines.position));
    return { ...row.order, lines, partyName: row.partyName };
  }

  async insertOrder(values: typeof salesOrders.$inferInsert): Promise<SalesOrder> {
    const [row] = await this.database.insert(salesOrders).values(values).returning();
    return row;
  }

  async replaceOrderLines(
    companyId: string,
    orderId: string,
    values: Omit<typeof salesOrderLines.$inferInsert, "companyId" | "orderId">[]
  ): Promise<void> {
    await this.database
      .delete(salesOrderLines)
      .where(and(eq(salesOrderLines.companyId, companyId), eq(salesOrderLines.orderId, orderId)));
    if (values.length === 0) return;
    await this.database
      .insert(salesOrderLines)
      .values(values.map((line) => ({ ...line, companyId, orderId })));
  }

  async updateOrder(
    companyId: string,
    orderId: string,
    patch: Partial<typeof salesOrders.$inferInsert>
  ): Promise<SalesOrder | null> {
    const [row] = await this.database
      .update(salesOrders)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(salesOrders.companyId, companyId), eq(salesOrders.id, orderId)))
      .returning();
    return row ?? null;
  }
}

export const salesRepository = new SalesRepository();
