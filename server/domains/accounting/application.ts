/**
 * Posting engine: turns **logical keys** into a balanced entry and persists it in the
 * calling document's transaction ([FR-CPT-1], [BR-7]).
 *
 * No account number is hard-coded here: resolution goes through `account_mappings`,
 * which makes the accounting standard swappable ([BR-21]).
 */

import {
  assertBalanced,
  buildCarryForwardPosting,
  chartTemplateFor,
  type ChartAccountTemplate,
  type ChartTemplate,
  type PostingLine,
} from "@shared/accounting-rules";
import { addDays } from "@shared/format";
import {
  accounts as accountsTable,
  journals as journalsTable,
  type Account,
  type AccountMappingKey,
  type Company,
  type EntryOrigin,
  type FiscalYear,
  type JournalEntry,
  type JournalType,
} from "@shared/schema";
import { db, runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { tr, type Locale } from "../../shared/i18n";
import { numberingApplication } from "../numbering/application";
import { accountingRepository, accountsRepository } from "./repository";

export interface PostEntryInput {
  company: Pick<Company, "id" | "fiscalYearStartMonth" | "accountingStandard">;
  journalType: JournalType;
  date: string;
  label: string;
  reference?: string;
  originType: EntryOrigin;
  originId?: string | null;
  lines: PostingLine[];
  clientUuid?: string | null;
}

/**
 * Default chart of accounts of a standard, with account and journal names translated
 * into `locale` (the request locale by default). Use it wherever default accounts or
 * journals are written for a company, so a company created in French gets French names.
 */
export function localizedChartTemplate(
  standard: Company["accountingStandard"],
  locale?: Locale
): ChartTemplate {
  const template = chartTemplateFor(standard);
  return {
    ...template,
    accounts: template.accounts.map((account) => ({
      ...account,
      name: tr(account.name, undefined, locale),
    })),
    journals: template.journals.map((journal) => ({
      ...journal,
      name: tr(journal.name, undefined, locale),
    })),
  };
}

/** Closest parent of a chart account: the longest other code that prefixes it (10 for 101). */
function parentCodeOf(accounts: ChartAccountTemplate[], code: string): string | undefined {
  return accounts
    .filter((candidate) => candidate.code !== code && code.startsWith(candidate.code))
    .sort((a, b) => b.code.length - a.code.length)[0]?.code;
}

/** Last day of the twelve-month year that starts on `startDate` (YYYY-MM-DD). */
function oneYearLater(startDate: string): string {
  const [year, month, day] = startDate.split("-");
  return addDays(`${Number(year) + 1}-${month}-${day}`, -1);
}

class AccountingApplication {
  /**
   * Resolves a logical key to an account. An unmapped key is a configuration error,
   * not missing data: better to block the validation than to post an entry to the
   * wrong account.
   */
  private resolveAccountId(
    mappings: Map<AccountMappingKey, string>,
    line: PostingLine,
    standard: Company["accountingStandard"]
  ): string {
    if (line.accountId) return line.accountId;
    const accountId = mappings.get(line.mappingKey);
    if (accountId) return accountId;
    const template = localizedChartTemplate(standard);
    const suggestion = template.accounts.find((a) => a.mappingKey === line.mappingKey);
    throw new BusinessRuleError(
      suggestion
        ? tr(
            'Accounting not configured: no account is mapped to "{key}" (expected: {code} — {name}).',
            { key: line.mappingKey, code: suggestion.code, name: suggestion.name }
          )
        : tr('Accounting not configured: no account is mapped to "{key}".', {
            key: line.mappingKey,
          }),
      "ACCOUNT_MAPPING_MISSING",
      { mappingKey: line.mappingKey }
    );
  }

  /**
   * Creates the entry. Idempotent per origin: if an entry already exists for the
   * (origin, id) pair it is returned as is — replaying a sync ingestion therefore can
   * never post twice ([BR-8]).
   *
   * An entry whose lines are all zero (free item, 100 % discount, invoice at 0 MRU) has
   * nothing to record: no entry is created and `null` is returned.
   */
  async postEntry(tx: Database, input: PostEntryInput): Promise<JournalEntry | null> {
    const repository = accountingRepository.withTransaction(tx);

    if (input.originId) {
      const existing = await repository.findEntryByOrigin(
        input.company.id,
        input.originType,
        input.originId
      );
      if (existing) return existing;
    }

    const relevantLines = input.lines.filter(
      (line) => line.debitCents !== 0 || line.creditCents !== 0
    );
    if (relevantLines.length === 0) return null;
    const { totalDebitCents, totalCreditCents } = assertBalanced(relevantLines);

    const journal = await repository.findJournalByType(input.company.id, input.journalType);
    if (!journal) {
      throw new BusinessRuleError(
        tr('No journal of type "{type}" is configured for this company.', {
          type: input.journalType,
        }),
        "JOURNAL_MISSING"
      );
    }

    // Sequential: these queries share the transaction's connection.
    const mappings = await repository.loadMappings(input.company.id);
    await this.installMissingMappings(tx, input.company, mappings, relevantLines);
    const fiscalYear = await repository.findFiscalYearFor(input.company.id, input.date);

    if (fiscalYear?.isClosed) {
      throw new BusinessRuleError(
        tr("Fiscal year {name} is closed: no entry can be added to it.", {
          name: fiscalYear.name,
        }),
        "FISCAL_YEAR_CLOSED"
      );
    }

    const number = await numberingApplication.allocateForCompany(
      tx,
      input.company,
      "JOURNAL_ENTRY",
      input.date
    );

    const entry = await repository.insertEntry({
      companyId: input.company.id,
      number,
      journalId: journal.id,
      fiscalYearId: fiscalYear?.id ?? null,
      date: input.date,
      reference: input.reference ?? "",
      label: input.label,
      originType: input.originType,
      originId: input.originId ?? null,
      isValidated: true,
      totalDebitCents,
      totalCreditCents,
      clientUuid: input.clientUuid ?? null,
    });

    await repository.insertLines(
      relevantLines.map((line, index) => ({
        companyId: input.company.id,
        entryId: entry.id,
        accountId: this.resolveAccountId(mappings, line, input.company.accountingStandard),
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        label: line.label,
        partyId: line.partyId ?? null,
        position: index,
      }))
    );

    return entry;
  }

  /**
   * A company created before a logical key existed (e.g. `SUSPENSE`) has no account for
   * it. Rather than blocking the operation, the default account of its chart is added
   * and mapped — only for keys with no mapping, so the user's own choices stay intact.
   */
  private async installMissingMappings(
    tx: Database,
    company: Pick<Company, "id" | "accountingStandard">,
    mappings: Map<AccountMappingKey, string>,
    lines: PostingLine[]
  ): Promise<void> {
    const template = localizedChartTemplate(company.accountingStandard);
    for (const line of lines) {
      if (line.accountId || mappings.has(line.mappingKey)) continue;
      const account = template.accounts.find((a) => a.mappingKey === line.mappingKey);
      if (!account) continue;
      const accountId = await this.ensureTemplateAccount(tx, company, template, account.code);
      if (!accountId) continue;
      await accountingRepository
        .withTransaction(tx)
        .upsertMapping(company.id, line.mappingKey, accountId);
      mappings.set(line.mappingKey, accountId);
    }
  }

  /** Returns the company's account with this code, creating it (and its parent) from the template. */
  private async ensureTemplateAccount(
    tx: Database,
    company: Pick<Company, "id">,
    template: ChartTemplate,
    code: string
  ): Promise<string | null> {
    const repository = accountingRepository.withTransaction(tx);
    const existing = await repository.findAccountByCode(company.id, code);
    if (existing) return existing.id;
    const account = template.accounts.find((candidate) => candidate.code === code);
    if (!account) return null;
    const parentCode = parentCodeOf(template.accounts, code);
    const parentId = parentCode
      ? await this.ensureTemplateAccount(tx, company, template, parentCode)
      : null;
    const [row] = await tx
      .insert(accountsTable)
      .values({
        companyId: company.id,
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        isGroup: account.isGroup ?? false,
        parentId,
      })
      .onConflictDoNothing()
      .returning({ id: accountsTable.id });
    return row?.id ?? (await repository.findAccountByCode(company.id, code))?.id ?? null;
  }

  /** Existing entry for an origin, if any — lets callers stay idempotent. */
  async findEntryByOrigin(
    companyId: string,
    originType: EntryOrigin,
    originId: string,
    database: Database = db
  ): Promise<JournalEntry | null> {
    return accountingRepository
      .withTransaction(database)
      .findEntryByOrigin(companyId, originType, originId);
  }

  /** An account of the company's chart that can receive postings (not a summary account). */
  async requirePostableAccount(
    companyId: string,
    accountId: string,
    database: Database = db
  ): Promise<Account> {
    const account = await accountsRepository
      .withTransaction(database)
      .findById(companyId, accountId);
    if (!account) throw new NotFoundError("Account not found.");
    if (account.isGroup) {
      throw new BusinessRuleError(
        "This account is a heading: choose one of the accounts under it.",
        "ACCOUNT_IS_GROUP"
      );
    }
    return account;
  }

  /** Creates a fiscal year; two years may never share a day. */
  async createFiscalYear(
    companyId: string,
    input: { name: string; startDate: string; endDate: string }
  ): Promise<FiscalYear> {
    if (input.endDate <= input.startDate) {
      throw new BusinessRuleError("The end date must be after the start date.");
    }
    return runInTransaction(async (tx) => {
      const repository = accountingRepository.withTransaction(tx);
      const overlapping = await repository.findOverlappingFiscalYear(
        companyId,
        input.startDate,
        input.endDate
      );
      if (overlapping) {
        throw new BusinessRuleError(
          tr("These dates overlap fiscal year {name}. Choose dates after or before it.", {
            name: overlapping.name,
          }),
          "FISCAL_YEAR_OVERLAP"
        );
      }
      return repository.insertFiscalYear({ companyId, ...input });
    });
  }

  /**
   * Closes a fiscal year:
   *  1. years are closed in order — an earlier year still open blocks the closing;
   *  2. the next year is used, or created (twelve months starting the day after) if
   *     there is none yet;
   *  3. an opening entry dated the first day of the next year carries over the
   *     balance-sheet accounts, and the year's profit or loss goes to retained earnings
   *     (`RESULT_CARRY_FORWARD`, 110 in OHADA/PCG);
   *  4. the year is flagged closed: `postEntry` then refuses any entry dated in it.
   */
  async closeFiscalYear(
    company: Pick<Company, "id" | "fiscalYearStartMonth" | "accountingStandard">,
    fiscalYearId: string
  ): Promise<
    FiscalYear & { nextFiscalYear: FiscalYear; openingEntryId: string | null; resultCents: number }
  > {
    return runInTransaction(async (tx) => {
      const repository = accountingRepository.withTransaction(tx);
      const year = await repository.lockFiscalYear(company.id, fiscalYearId);
      if (!year) throw new NotFoundError("Fiscal year not found.");
      if (year.isClosed) {
        throw new BusinessRuleError(
          tr("Fiscal year {name} is already closed.", { name: year.name }),
          "FISCAL_YEAR_ALREADY_CLOSED"
        );
      }
      const earlier = await repository.findOpenFiscalYearBefore(company.id, year.startDate);
      if (earlier) {
        throw new BusinessRuleError(
          tr("Close fiscal year {name} first: it comes before this one.", { name: earlier.name }),
          "FISCAL_YEAR_EARLIER_OPEN"
        );
      }

      let next = await repository.findFiscalYearAfter(company.id, year.endDate);
      if (!next) {
        const startDate = addDays(year.endDate, 1);
        const endDate = oneYearLater(startDate);
        const startYear = startDate.slice(0, 4);
        const endYear = endDate.slice(0, 4);
        next = await repository.insertFiscalYear({
          companyId: company.id,
          name: startYear === endYear ? startYear : `${startYear}-${endYear}`,
          startDate,
          endDate,
        });
      }

      const balances = await repository.periodBalancesByParty(
        company.id,
        year.startDate,
        year.endDate
      );
      const label = tr("Opening balances carried over from {name}", { name: year.name });
      const { lines, resultCents } = buildCarryForwardPosting({ balances, label });
      const entry = await this.postEntry(tx, {
        company,
        journalType: "MISC",
        date: next.startDate,
        label,
        reference: year.name,
        originType: "opening",
        originId: year.id,
        lines,
      });

      const closed = await repository.markFiscalYearClosed(company.id, year.id);
      if (!closed) throw new NotFoundError("Fiscal year not found.");
      return { ...closed, nextFiscalYear: next, openingEntryId: entry?.id ?? null, resultCents };
    });
  }

  /**
   * Installs a company's chart of accounts and journals when it is created. Names are
   * translated into `locale` (the request locale by default).
   */
  async installChartOfAccounts(
    tx: Database,
    company: Pick<Company, "id" | "accountingStandard">,
    locale?: Locale
  ): Promise<void> {
    const template = localizedChartTemplate(company.accountingStandard, locale);
    const repository = accountingRepository.withTransaction(tx);

    // Parent accounts must exist before their children: sorting by code length
    // reproduces the chart hierarchy (10 before 101).
    const ordered = [...template.accounts].sort((a, b) => a.code.length - b.code.length);
    const byCode = new Map<string, string>();

    for (const account of ordered) {
      const parentCode = parentCodeOf(ordered, account.code);

      const [row] = await tx
        .insert(accountsTable)
        .values({
          companyId: company.id,
          code: account.code,
          name: account.name,
          accountType: account.accountType,
          isGroup: account.isGroup ?? false,
          parentId: parentCode ? (byCode.get(parentCode) ?? null) : null,
        })
        .onConflictDoNothing()
        .returning({ id: accountsTable.id });

      const accountId =
        row?.id ?? (await repository.findAccountByCode(company.id, account.code))?.id;
      if (!accountId) continue;
      byCode.set(account.code, accountId);
      if (account.mappingKey) {
        await repository.upsertMapping(company.id, account.mappingKey, accountId);
      }
    }

    for (const journal of template.journals) {
      await tx
        .insert(journalsTable)
        .values({
          companyId: company.id,
          code: journal.code,
          name: journal.name,
          journalType: journal.journalType,
        })
        .onConflictDoNothing();
    }
  }
}

export const accountingApplication = new AccountingApplication();
