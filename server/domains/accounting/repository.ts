/** Accounting persistence: chart, journals, entries, general ledger, trial balance. */

import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";

import {
  accountMappings,
  accounts,
  fiscalYears,
  journalEntries,
  journalLines,
  journals,
  parties,
  type Account,
  type AccountMappingKey,
  type Journal,
  type JournalEntry,
} from "@shared/schema";
import { db, type Database } from "../../db";
import { TenantRepository } from "../../shared/db/tenant-repository";

export const accountsRepository = new TenantRepository(accounts, [accounts.code, accounts.name]);
export const journalsRepository = new TenantRepository(journals, [journals.code, journals.name]);
export const fiscalYearsRepository = new TenantRepository(fiscalYears, [fiscalYears.name]);

export interface LedgerRow {
  lineId: string;
  entryId: string;
  entryNumber: string;
  date: string;
  journalCode: string;
  accountCode: string;
  accountName: string;
  label: string;
  reference: string;
  partyName: string | null;
  debitCents: number;
  creditCents: number;
}

export interface BalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: Account["accountType"];
  debitCents: number;
  creditCents: number;
}

export class AccountingRepository {
  constructor(private readonly database: Database = db) {}

  withTransaction(tx: Database): AccountingRepository {
    return new AccountingRepository(tx);
  }

  async findAccountByCode(companyId: string, code: string): Promise<Account | null> {
    const [row] = await this.database
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)))
      .limit(1);
    return row ?? null;
  }

  /** Accounts backing the logical keys — resolution of automatic entries. */
  async loadMappings(companyId: string): Promise<Map<AccountMappingKey, string>> {
    const rows = await this.database
      .select({ key: accountMappings.key, accountId: accountMappings.accountId })
      .from(accountMappings)
      .where(eq(accountMappings.companyId, companyId));
    return new Map(rows.map((row) => [row.key, row.accountId]));
  }

  async upsertMapping(companyId: string, key: AccountMappingKey, accountId: string): Promise<void> {
    await this.database
      .insert(accountMappings)
      .values({ companyId, key, accountId })
      .onConflictDoUpdate({
        target: [accountMappings.companyId, accountMappings.key],
        set: { accountId, updatedAt: new Date() },
      });
  }

  async findJournalByType(
    companyId: string,
    journalType: Journal["journalType"]
  ): Promise<Journal | null> {
    const [row] = await this.database
      .select()
      .from(journals)
      .where(and(eq(journals.companyId, companyId), eq(journals.journalType, journalType)))
      .limit(1);
    return row ?? null;
  }

  async findFiscalYearFor(companyId: string, date: string) {
    const [row] = await this.database
      .select()
      .from(fiscalYears)
      .where(
        and(
          eq(fiscalYears.companyId, companyId),
          lte(fiscalYears.startDate, date),
          gte(fiscalYears.endDate, date)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async insertEntry(values: typeof journalEntries.$inferInsert): Promise<JournalEntry> {
    const [row] = await this.database.insert(journalEntries).values(values).returning();
    return row;
  }

  async insertLines(values: (typeof journalLines.$inferInsert)[]): Promise<void> {
    if (values.length === 0) return;
    await this.database.insert(journalLines).values(values);
  }

  async findEntryByOrigin(
    companyId: string,
    originType: JournalEntry["originType"],
    originId: string
  ): Promise<JournalEntry | null> {
    const [row] = await this.database
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          eq(journalEntries.originType, originType),
          eq(journalEntries.originId, originId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async listEntries(
    companyId: string,
    options: {
      journalId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where = and(
      eq(journalEntries.companyId, companyId),
      options.journalId ? eq(journalEntries.journalId, options.journalId) : undefined,
      options.fromDate ? gte(journalEntries.date, options.fromDate) : undefined,
      options.toDate ? lte(journalEntries.date, options.toDate) : undefined
    );

    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({ entry: journalEntries, journalCode: journals.code, journalName: journals.name })
        .from(journalEntries)
        .innerJoin(journals, eq(journals.id, journalEntries.journalId))
        .where(where)
        .orderBy(desc(journalEntries.date), desc(journalEntries.number))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(journalEntries)
        .where(where),
    ]);

    return {
      items: rows.map((row) => ({
        ...row.entry,
        journalCode: row.journalCode,
        journalName: row.journalName,
      })),
      total: countRow?.value ?? 0,
    };
  }

  async listEntryLines(companyId: string, entryIds: string[]) {
    if (entryIds.length === 0) return [];
    return this.database
      .select({
        line: journalLines,
        accountCode: accounts.code,
        accountName: accounts.name,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(journalLines.companyId, companyId), inArray(journalLines.entryId, entryIds)))
      .orderBy(asc(journalLines.position));
  }

  /** General ledger: entries of an account over a period [FR-CPT-2]. */
  async ledger(
    companyId: string,
    options: {
      accountId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ items: LedgerRow[]; total: number }> {
    const conditions: (SQL | undefined)[] = [
      eq(journalLines.companyId, companyId),
      options.accountId ? eq(journalLines.accountId, options.accountId) : undefined,
      options.fromDate ? gte(journalEntries.date, options.fromDate) : undefined,
      options.toDate ? lte(journalEntries.date, options.toDate) : undefined,
    ];
    const where = and(...conditions.filter(Boolean));

    const [rows, [countRow]] = await Promise.all([
      this.database
        .select({
          lineId: journalLines.id,
          entryId: journalEntries.id,
          entryNumber: journalEntries.number,
          date: journalEntries.date,
          journalCode: journals.code,
          accountCode: accounts.code,
          accountName: accounts.name,
          label: journalLines.label,
          reference: journalEntries.reference,
          partyName: parties.name,
          debitCents: journalLines.debitCents,
          creditCents: journalLines.creditCents,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .innerJoin(journals, eq(journals.id, journalEntries.journalId))
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .leftJoin(parties, eq(parties.id, journalLines.partyId))
        .where(where)
        .orderBy(asc(journalEntries.date), asc(journalEntries.number), asc(journalLines.position))
        .limit(options.limit ?? 100)
        .offset(options.offset ?? 0),
      this.database
        .select({ value: sql<number>`count(*)::int` })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(where),
    ]);

    return { items: rows as LedgerRow[], total: countRow?.value ?? 0 };
  }

  /** Trial balance: debit/credit totals per account [FR-CPT-3]. */
  async balance(
    companyId: string,
    options: { fromDate?: string | null; toDate?: string | null } = {}
  ): Promise<BalanceRow[]> {
    const rows = await this.database
      .select({
        accountId: accounts.id,
        code: accounts.code,
        name: accounts.name,
        accountType: accounts.accountType,
        debitCents: sql<number>`coalesce(sum(${journalLines.debitCents}), 0)::int`,
        creditCents: sql<number>`coalesce(sum(${journalLines.creditCents}), 0)::int`,
      })
      .from(accounts)
      .leftJoin(journalLines, eq(journalLines.accountId, accounts.id))
      .leftJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(
        and(
          eq(accounts.companyId, companyId),
          eq(accounts.isGroup, false),
          options.fromDate ? gte(journalEntries.date, options.fromDate) : undefined,
          options.toDate ? lte(journalEntries.date, options.toDate) : undefined
        )
      )
      .groupBy(accounts.id, accounts.code, accounts.name, accounts.accountType)
      .orderBy(asc(accounts.code));
    return rows as BalanceRow[];
  }

  /** Balance of a treasury account, to reconcile `bank_accounts.balance_cents`. */
  async accountBalance(companyId: string, accountId: string) {
    const [row] = await this.database
      .select({
        debitCents: sql<number>`coalesce(sum(${journalLines.debitCents}), 0)::int`,
        creditCents: sql<number>`coalesce(sum(${journalLines.creditCents}), 0)::int`,
      })
      .from(journalLines)
      .where(and(eq(journalLines.companyId, companyId), eq(journalLines.accountId, accountId)));
    return { debitCents: row?.debitCents ?? 0, creditCents: row?.creditCents ?? 0 };
  }
}

export const accountingRepository = new AccountingRepository();
