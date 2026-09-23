/** Persistance de la trésorerie : comptes et mouvements. */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import {
  bankAccounts,
  bankTransactions,
  type BankAccount,
  type BankTransaction,
} from "@shared/schema";
import { db, type Database } from "../../db";
import { TenantRepository } from "../../shared/db/tenant-repository";

export const bankAccountsRepository = new TenantRepository(bankAccounts, [
  bankAccounts.code,
  bankAccounts.name,
  bankAccounts.accountNumber,
]);

export class BankingRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): BankingRepository {
    return new BankingRepository(tx);
  }

  async findDefaultFor(
    companyId: string,
    accountType: BankAccount["accountType"]
  ): Promise<BankAccount | null> {
    const [row] = await this.database
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.companyId, companyId),
          eq(bankAccounts.isActive, true),
          eq(bankAccounts.accountType, accountType)
        )
      )
      .orderBy(desc(bankAccounts.isDefault))
      .limit(1);
    return row ?? null;
  }

  async insertTransaction(values: typeof bankTransactions.$inferInsert): Promise<BankTransaction> {
    const [row] = await this.database.insert(bankTransactions).values(values).returning();
    return row;
  }

  /** Ajuste le solde en base (jamais par relecture-réécriture), comme pour le stock. */
  async applyBalanceDelta(
    companyId: string,
    bankAccountId: string,
    deltaCents: number
  ): Promise<BankAccount | null> {
    const [row] = await this.database
      .update(bankAccounts)
      .set({
        balanceCents: sql`${bankAccounts.balanceCents} + ${deltaCents}`,
        updatedAt: new Date(),
      })
      .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.id, bankAccountId)))
      .returning();
    return row ?? null;
  }

  async listTransactions(
    companyId: string,
    options: {
      bankAccountId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      reconciled?: boolean | null;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where = and(
      eq(bankTransactions.companyId, companyId),
      options.bankAccountId ? eq(bankTransactions.bankAccountId, options.bankAccountId) : undefined,
      options.fromDate ? gte(bankTransactions.date, options.fromDate) : undefined,
      options.toDate ? lte(bankTransactions.date, options.toDate) : undefined,
      options.reconciled == null ? undefined : eq(bankTransactions.reconciled, options.reconciled)
    );

    const [items, [countRow]] = await Promise.all([
      this.database
        .select()
        .from(bankTransactions)
        .where(where)
        .orderBy(desc(bankTransactions.date), desc(bankTransactions.createdAt))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(bankTransactions)
        .where(where),
    ]);
    return { items, total: countRow?.value ?? 0 };
  }

  async setReconciled(
    companyId: string,
    transactionId: string,
    reconciled: boolean
  ): Promise<BankTransaction | null> {
    const [row] = await this.database
      .update(bankTransactions)
      .set({ reconciled, updatedAt: new Date() })
      .where(and(eq(bankTransactions.companyId, companyId), eq(bankTransactions.id, transactionId)))
      .returning();
    return row ?? null;
  }

  /** Totaux de trésorerie, tous comptes confondus — carte du tableau de bord. */
  async treasuryTotals(companyId: string) {
    const [row] = await this.database
      .select({
        cashCents: sql<number>`coalesce(sum(${bankAccounts.balanceCents}) filter (where ${bankAccounts.accountType} = 'CASH'), 0)::int`,
        bankCents: sql<number>`coalesce(sum(${bankAccounts.balanceCents}) filter (where ${bankAccounts.accountType} = 'BANK'), 0)::int`,
        mobileCents: sql<number>`coalesce(sum(${bankAccounts.balanceCents}) filter (where ${bankAccounts.accountType} = 'MOBILE_MONEY'), 0)::int`,
        totalCents: sql<number>`coalesce(sum(${bankAccounts.balanceCents}), 0)::int`,
      })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.isActive, true)));
    return {
      cashCents: row?.cashCents ?? 0,
      bankCents: row?.bankCents ?? 0,
      mobileCents: row?.mobileCents ?? 0,
      totalCents: row?.totalCents ?? 0,
    };
  }
}

export const bankingRepository = new BankingRepository();
