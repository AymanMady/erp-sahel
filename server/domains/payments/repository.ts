/** Payment persistence. */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { bankAccounts, parties, payments, salesInvoices, type Payment } from "@shared/schema";
import { db, type Database } from "../../db";

export interface PaymentListItem extends Payment {
  partyName: string;
  invoiceNumber: string | null;
  bankAccountName: string | null;
}

export class PaymentsRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): PaymentsRepository {
    return new PaymentsRepository(tx);
  }

  async insert(values: typeof payments.$inferInsert): Promise<Payment> {
    const [row] = await this.database.insert(payments).values(values).returning();
    return row;
  }

  async findById(companyId: string, paymentId: string): Promise<Payment | null> {
    const [row] = await this.database
      .select()
      .from(payments)
      .where(and(eq(payments.companyId, companyId), eq(payments.id, paymentId)))
      .limit(1);
    return row ?? null;
  }

  async findByClientUuid(companyId: string, clientUuid: string): Promise<Payment | null> {
    const [row] = await this.database
      .select()
      .from(payments)
      .where(and(eq(payments.companyId, companyId), eq(payments.clientUuid, clientUuid)))
      .limit(1);
    return row ?? null;
  }

  async list(
    companyId: string,
    options: {
      partyId?: string | null;
      invoiceId?: string | null;
      direction?: Payment["direction"] | null;
      method?: Payment["paymentMethod"] | null;
      posSessionId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ items: PaymentListItem[]; total: number }> {
    const where = and(
      eq(payments.companyId, companyId),
      options.partyId ? eq(payments.partyId, options.partyId) : undefined,
      options.invoiceId ? eq(payments.invoiceId, options.invoiceId) : undefined,
      options.direction ? eq(payments.direction, options.direction) : undefined,
      options.method ? eq(payments.paymentMethod, options.method) : undefined,
      options.posSessionId ? eq(payments.posSessionId, options.posSessionId) : undefined,
      options.fromDate ? gte(payments.paymentDate, options.fromDate) : undefined,
      options.toDate ? lte(payments.paymentDate, options.toDate) : undefined
    );

    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({
          payment: payments,
          partyName: parties.name,
          invoiceNumber: salesInvoices.number,
          bankAccountName: bankAccounts.name,
        })
        .from(payments)
        .innerJoin(parties, eq(parties.id, payments.partyId))
        .leftJoin(salesInvoices, eq(salesInvoices.id, payments.invoiceId))
        .leftJoin(bankAccounts, eq(bankAccounts.id, payments.bankAccountId))
        .where(where)
        .orderBy(desc(payments.paymentDate), desc(payments.createdAt))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(payments)
        .where(where),
    ]);

    return {
      items: rows.map((row) => ({
        ...row.payment,
        partyName: row.partyName,
        invoiceNumber: row.invoiceNumber,
        bankAccountName: row.bankAccountName,
      })),
      total: countRow?.value ?? 0,
    };
  }

  /** Receipts of a period, broken down by method — cash report [FR-RPT-1]. */
  async collectionsByMethod(companyId: string, fromDate: string, toDate: string) {
    return this.database
      .select({
        paymentMethod: payments.paymentMethod,
        totalCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.companyId, companyId),
          eq(payments.direction, "IN"),
          eq(payments.status, "CONFIRMED"),
          gte(payments.paymentDate, fromDate),
          lte(payments.paymentDate, toDate)
        )
      )
      .groupBy(payments.paymentMethod);
  }

  /** Total collected in a register session, by method — POS closing [FR-POS-2]. */
  async sessionTotals(companyId: string, posSessionId: string) {
    const rows = await this.database
      .select({
        paymentMethod: payments.paymentMethod,
        totalCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.companyId, companyId),
          eq(payments.posSessionId, posSessionId),
          eq(payments.direction, "IN"),
          eq(payments.status, "CONFIRMED")
        )
      )
      .groupBy(payments.paymentMethod);
    const totalCents = rows.reduce((sum, row) => sum + row.totalCents, 0);
    const cashCents = rows.find((row) => row.paymentMethod === "CASH")?.totalCents ?? 0;
    return { byMethod: rows, totalCents, cashCents };
  }
}

export const paymentsRepository = new PaymentsRepository();
