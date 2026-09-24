/**
 * Posting engine: turns **logical keys** into a balanced entry and persists it in the
 * calling document's transaction ([FR-CPT-1], [BR-7]).
 *
 * No account number is hard-coded here: resolution goes through `account_mappings`,
 * which makes the accounting standard swappable ([BR-21]).
 */

import {
  assertBalanced,
  chartTemplateFor,
  type ChartTemplate,
  type PostingLine,
} from "@shared/accounting-rules";
import {
  accounts as accountsTable,
  journals as journalsTable,
  type AccountMappingKey,
  type Company,
  type EntryOrigin,
  type JournalEntry,
  type JournalType,
} from "@shared/schema";
import type { Database } from "../../db";
import { BusinessRuleError } from "../../shared/errors/app-error";
import { tr, type Locale } from "../../shared/i18n";
import { numberingApplication } from "../numbering/application";
import { accountingRepository } from "./repository";

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
   */
  async postEntry(tx: Database, input: PostEntryInput): Promise<JournalEntry> {
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
    if (relevantLines.length === 0) {
      throw new BusinessRuleError("An entry must have at least one non-zero line.");
    }
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
      const parentCode = ordered
        .filter((candidate) => candidate.code !== account.code)
        .filter((candidate) => account.code.startsWith(candidate.code))
        .sort((a, b) => b.code.length - a.code.length)[0]?.code;

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
