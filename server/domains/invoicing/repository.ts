/** Customer invoicing persistence (invoices, lines, credit notes). */

import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";

import {
  creditNoteLines,
  creditNotes,
  parties,
  salesInvoiceLines,
  salesInvoices,
  type CreditNote,
  type SalesInvoice,
  type SalesInvoiceLine,
} from "@shared/schema";
import { db, type Database } from "../../db";

export interface InvoiceListItem extends SalesInvoice {
  partyName: string;
  partyCode: string;
}

export interface InvoiceWithLines extends SalesInvoice {
  lines: SalesInvoiceLine[];
  partyName: string;
  partyCode: string;
}

export interface InvoiceListOptions {
  search?: string;
  status?: SalesInvoice["status"] | null;
  partyId?: string | null;
  source?: SalesInvoice["source"] | null;
  posSessionId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  unpaidOnly?: boolean;
  limit?: number;
  offset?: number;
}

export class InvoicingRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): InvoicingRepository {
    return new InvoicingRepository(tx);
  }

  private listConditions(companyId: string, options: InvoiceListOptions): SQL {
    const conditions: (SQL | undefined)[] = [
      eq(salesInvoices.companyId, companyId),
      options.status ? eq(salesInvoices.status, options.status) : undefined,
      options.partyId ? eq(salesInvoices.partyId, options.partyId) : undefined,
      options.source ? eq(salesInvoices.source, options.source) : undefined,
      options.posSessionId ? eq(salesInvoices.posSessionId, options.posSessionId) : undefined,
      options.fromDate ? gte(salesInvoices.date, options.fromDate) : undefined,
      options.toDate ? lte(salesInvoices.date, options.toDate) : undefined,
      options.unpaidOnly
        ? and(
            inArray(salesInvoices.status, ["VALIDATED", "PARTIALLY_PAID"]),
            sql`${salesInvoices.totalTtcCents} > ${salesInvoices.paidAmountCents}`
          )
        : undefined,
      options.search
        ? sql`(${salesInvoices.number} ilike ${`%${options.search}%`} or ${parties.name} ilike ${`%${options.search}%`})`
        : undefined,
    ];
    return and(...conditions.filter(Boolean)) as SQL;
  }

  async list(
    companyId: string,
    options: InvoiceListOptions = {}
  ): Promise<{ items: InvoiceListItem[]; total: number }> {
    const where = this.listConditions(companyId, options);
    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({ invoice: salesInvoices, partyName: parties.name, partyCode: parties.code })
        .from(salesInvoices)
        .innerJoin(parties, eq(parties.id, salesInvoices.partyId))
        .where(where)
        .orderBy(desc(salesInvoices.date), desc(salesInvoices.createdAt))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(salesInvoices)
        .innerJoin(parties, eq(parties.id, salesInvoices.partyId))
        .where(where),
    ]);
    return {
      items: rows.map((row) => ({
        ...row.invoice,
        partyName: row.partyName,
        partyCode: row.partyCode,
      })),
      total: countRow?.value ?? 0,
    };
  }

  async findById(companyId: string, invoiceId: string): Promise<InvoiceWithLines | null> {
    const [row] = await this.database
      .select({ invoice: salesInvoices, partyName: parties.name, partyCode: parties.code })
      .from(salesInvoices)
      .innerJoin(parties, eq(parties.id, salesInvoices.partyId))
      .where(and(eq(salesInvoices.companyId, companyId), eq(salesInvoices.id, invoiceId)))
      .limit(1);
    if (!row) return null;
    const lines = await this.listLines(companyId, invoiceId);
    return { ...row.invoice, lines, partyName: row.partyName, partyCode: row.partyCode };
  }

  async findByClientUuid(companyId: string, clientUuid: string): Promise<SalesInvoice | null> {
    const [row] = await this.database
      .select()
      .from(salesInvoices)
      .where(and(eq(salesInvoices.companyId, companyId), eq(salesInvoices.clientUuid, clientUuid)))
      .limit(1);
    return row ?? null;
  }

  async listLines(companyId: string, invoiceId: string): Promise<SalesInvoiceLine[]> {
    return this.database
      .select()
      .from(salesInvoiceLines)
      .where(
        and(eq(salesInvoiceLines.companyId, companyId), eq(salesInvoiceLines.invoiceId, invoiceId))
      )
      .orderBy(asc(salesInvoiceLines.position));
  }

  async insert(values: typeof salesInvoices.$inferInsert): Promise<SalesInvoice> {
    const [row] = await this.database.insert(salesInvoices).values(values).returning();
    return row;
  }

  async insertLines(values: (typeof salesInvoiceLines.$inferInsert)[]): Promise<void> {
    if (values.length === 0) return;
    await this.database.insert(salesInvoiceLines).values(values);
  }

  async replaceLines(
    companyId: string,
    invoiceId: string,
    values: Omit<typeof salesInvoiceLines.$inferInsert, "companyId" | "invoiceId">[]
  ): Promise<void> {
    await this.database
      .delete(salesInvoiceLines)
      .where(
        and(eq(salesInvoiceLines.companyId, companyId), eq(salesInvoiceLines.invoiceId, invoiceId))
      );
    await this.insertLines(values.map((line) => ({ ...line, companyId, invoiceId })));
  }

  async update(
    companyId: string,
    invoiceId: string,
    patch: Partial<typeof salesInvoices.$inferInsert>
  ): Promise<SalesInvoice | null> {
    const [row] = await this.database
      .update(salesInvoices)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(salesInvoices.companyId, companyId), eq(salesInvoices.id, invoiceId)))
      .returning();
    return row ?? null;
  }

  /**
   * Increments the paid amount **in the database** (`paid + delta`), not from a value
   * read beforehand: two simultaneous receipts on the same invoice stay consistent.
   */
  async addPaidAmount(
    companyId: string,
    invoiceId: string,
    deltaCents: number
  ): Promise<SalesInvoice | null> {
    const [row] = await this.database
      .update(salesInvoices)
      .set({
        paidAmountCents: sql`${salesInvoices.paidAmountCents} + ${deltaCents}`,
        updatedAt: new Date(),
      })
      .where(and(eq(salesInvoices.companyId, companyId), eq(salesInvoices.id, invoiceId)))
      .returning();
    return row ?? null;
  }

  async listCreditNotes(
    companyId: string,
    options: { invoiceId?: string | null; limit?: number; offset?: number } = {}
  ) {
    const where = and(
      eq(creditNotes.companyId, companyId),
      options.invoiceId ? eq(creditNotes.invoiceId, options.invoiceId) : undefined
    );
    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({ note: creditNotes, partyName: parties.name })
        .from(creditNotes)
        .innerJoin(parties, eq(parties.id, creditNotes.partyId))
        .where(where)
        .orderBy(desc(creditNotes.date))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(creditNotes)
        .where(where),
    ]);
    return {
      items: rows.map((row) => ({ ...row.note, partyName: row.partyName })),
      total: countRow?.value ?? 0,
    };
  }

  async findCreditNote(companyId: string, creditNoteId: string) {
    const [row] = await this.database
      .select({ note: creditNotes, partyName: parties.name })
      .from(creditNotes)
      .innerJoin(parties, eq(parties.id, creditNotes.partyId))
      .where(and(eq(creditNotes.companyId, companyId), eq(creditNotes.id, creditNoteId)))
      .limit(1);
    if (!row) return null;
    const lines = await this.database
      .select()
      .from(creditNoteLines)
      .where(
        and(
          eq(creditNoteLines.companyId, companyId),
          eq(creditNoteLines.creditNoteId, creditNoteId)
        )
      )
      .orderBy(asc(creditNoteLines.position));
    return { ...row.note, partyName: row.partyName, lines };
  }

  async insertCreditNote(values: typeof creditNotes.$inferInsert): Promise<CreditNote> {
    const [row] = await this.database.insert(creditNotes).values(values).returning();
    return row;
  }

  async insertCreditNoteLines(values: (typeof creditNoteLines.$inferInsert)[]): Promise<void> {
    if (values.length === 0) return;
    await this.database.insert(creditNoteLines).values(values);
  }

  /** Revenue and unpaid amounts — dashboard and reports [FR-RPT-1]. */
  async salesSummary(companyId: string, fromDate: string, toDate: string) {
    const [row] = await this.database
      .select({
        invoiceCount: sql<number>`count(*)::int`,
        totalHtCents: sql<number>`coalesce(sum(${salesInvoices.totalHtCents}), 0)::int`,
        totalTtcCents: sql<number>`coalesce(sum(${salesInvoices.totalTtcCents}), 0)::int`,
        paidCents: sql<number>`coalesce(sum(${salesInvoices.paidAmountCents}), 0)::int`,
      })
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.companyId, companyId),
          gte(salesInvoices.date, fromDate),
          lte(salesInvoices.date, toDate),
          inArray(salesInvoices.status, ["VALIDATED", "PARTIALLY_PAID", "PAID"])
        )
      );
    return {
      invoiceCount: row?.invoiceCount ?? 0,
      totalHtCents: row?.totalHtCents ?? 0,
      totalTtcCents: row?.totalTtcCents ?? 0,
      paidCents: row?.paidCents ?? 0,
      outstandingCents: (row?.totalTtcCents ?? 0) - (row?.paidCents ?? 0),
    };
  }

  /** Daily revenue, for the dashboard chart. */
  async dailyRevenue(companyId: string, fromDate: string, toDate: string) {
    return this.database
      .select({
        date: salesInvoices.date,
        totalHtCents: sql<number>`coalesce(sum(${salesInvoices.totalHtCents}), 0)::int`,
        totalTtcCents: sql<number>`coalesce(sum(${salesInvoices.totalTtcCents}), 0)::int`,
        invoiceCount: sql<number>`count(*)::int`,
      })
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.companyId, companyId),
          gte(salesInvoices.date, fromDate),
          lte(salesInvoices.date, toDate),
          inArray(salesInvoices.status, ["VALIDATED", "PARTIALLY_PAID", "PAID"])
        )
      )
      .groupBy(salesInvoices.date)
      .orderBy(asc(salesInvoices.date));
  }

  /** Best-selling products over a period [FR-RPT-3]. */
  async topProducts(companyId: string, fromDate: string, toDate: string, limit = 10) {
    return this.database
      .select({
        productId: salesInvoiceLines.productId,
        productSku: salesInvoiceLines.productSku,
        description: salesInvoiceLines.description,
        quantity: sql<string>`coalesce(sum(${salesInvoiceLines.quantity}), 0)`,
        revenueCents: sql<number>`coalesce(sum(${salesInvoiceLines.totalHtCents}), 0)::int`,
      })
      .from(salesInvoiceLines)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.invoiceId))
      .where(
        and(
          eq(salesInvoiceLines.companyId, companyId),
          gte(salesInvoices.date, fromDate),
          lte(salesInvoices.date, toDate),
          inArray(salesInvoices.status, ["VALIDATED", "PARTIALLY_PAID", "PAID"])
        )
      )
      .groupBy(
        salesInvoiceLines.productId,
        salesInvoiceLines.productSku,
        salesInvoiceLines.description
      )
      .orderBy(desc(sql`coalesce(sum(${salesInvoiceLines.totalHtCents}), 0)`))
      .limit(limit);
  }
}

export const invoicingRepository = new InvoicingRepository();
