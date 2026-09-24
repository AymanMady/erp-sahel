/** Application boundary of accounting. */

import { asc } from "drizzle-orm";

import { accountBalanceCents } from "@shared/accounting-rules";
import { accounts, fiscalYears, journals } from "@shared/schema";
import { runInTransaction } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { tenancyApplication } from "../tenancy/application";
import { accountingApplication } from "./application";
import {
  accountingRepository,
  accountsRepository,
  fiscalYearsRepository,
  journalsRepository,
} from "./repository";
import {
  createAccountSchema,
  createFiscalYearSchema,
  createJournalSchema,
  idParamSchema,
  ledgerQuerySchema,
  listEntriesQuerySchema,
  manualEntrySchema,
  mappingSchema,
  periodQuerySchema,
  updateAccountSchema,
  updateJournalSchema,
} from "./schemas";

export class AccountingService {
  async listAccounts(companyId: string) {
    return accountsRepository.listAll(companyId, { orderBy: [asc(accounts.code)] });
  }

  async createAccount(companyId: string, body: unknown) {
    return accountsRepository.create(companyId, createAccountSchema.parse(body));
  }

  async updateAccount(companyId: string, id: unknown, body: unknown) {
    const { id: accountId } = idParamSchema.parse({ id });
    const account = await accountsRepository.update(
      companyId,
      accountId,
      updateAccountSchema.parse(body)
    );
    if (!account) throw new NotFoundError("Account not found.");
    return account;
  }

  async archiveAccount(companyId: string, id: unknown) {
    const { id: accountId } = idParamSchema.parse({ id });
    const balance = await accountingRepository.accountBalance(companyId, accountId);
    if (balance.debitCents !== 0 || balance.creditCents !== 0) {
      throw new BusinessRuleError(
        "This account has entries: it cannot be archived.",
        "ACCOUNT_HAS_ENTRIES"
      );
    }
    const archived = await accountsRepository.archive(companyId, accountId);
    if (!archived) throw new NotFoundError("Account not found.");
    return { success: true as const };
  }

  async listJournals(companyId: string) {
    return journalsRepository.listAll(companyId, { orderBy: [asc(journals.code)] });
  }

  async createJournal(companyId: string, body: unknown) {
    return journalsRepository.create(companyId, createJournalSchema.parse(body));
  }

  async updateJournal(companyId: string, id: unknown, body: unknown) {
    const { id: journalId } = idParamSchema.parse({ id });
    const journal = await journalsRepository.update(
      companyId,
      journalId,
      updateJournalSchema.parse(body)
    );
    if (!journal) throw new NotFoundError("Journal not found.");
    return journal;
  }

  async listMappings(companyId: string) {
    const mappings = await accountingRepository.loadMappings(companyId);
    return [...mappings.entries()].map(([key, accountId]) => ({ key, accountId }));
  }

  async setMapping(companyId: string, body: unknown) {
    const data = mappingSchema.parse(body);
    await accountsRepository.requireById(companyId, data.accountId);
    await accountingRepository.upsertMapping(companyId, data.key, data.accountId);
    return { success: true as const };
  }

  async listEntries(companyId: string, query: unknown) {
    const parsed = listEntriesQuerySchema.parse(query ?? {});
    const result = await accountingRepository.listEntries(companyId, parsed);
    const lines = await accountingRepository.listEntryLines(
      companyId,
      result.items.map((entry) => entry.id)
    );
    const byEntry = new Map<string, typeof lines>();
    for (const line of lines) {
      const bucket = byEntry.get(line.line.entryId) ?? [];
      bucket.push(line);
      byEntry.set(line.line.entryId, bucket);
    }
    return {
      items: result.items.map((entry) => ({
        ...entry,
        lines: (byEntry.get(entry.id) ?? []).map((row) => ({
          ...row.line,
          accountCode: row.accountCode,
          accountName: row.accountName,
        })),
      })),
      total: result.total,
    };
  }

  async ledger(companyId: string, query: unknown) {
    return accountingRepository.ledger(companyId, ledgerQuerySchema.parse(query ?? {}));
  }

  /** Trial balance, enriched with the signed balance on the account's natural side. */
  async balance(companyId: string, query: unknown) {
    const parsed = periodQuerySchema.parse(query ?? {});
    const rows = await accountingRepository.balance(companyId, parsed);
    const items = rows.map((row) => ({
      ...row,
      balanceCents: accountBalanceCents(row.accountType, row.debitCents, row.creditCents),
    }));
    return {
      items,
      totals: {
        debitCents: items.reduce((sum, row) => sum + row.debitCents, 0),
        creditCents: items.reduce((sum, row) => sum + row.creditCents, 0),
      },
    };
  }

  /** Manual entry — the balance is checked before insertion. */
  async createManualEntry(companyId: string, body: unknown) {
    const data = manualEntrySchema.parse(body);
    const company = await tenancyApplication.requireCompany(companyId);

    for (const line of data.lines) {
      if (line.debitCents > 0 && line.creditCents > 0) {
        throw new BusinessRuleError("A line cannot be both a debit and a credit.");
      }
      await accountsRepository.requireById(companyId, line.accountId);
    }

    return runInTransaction((tx) =>
      accountingApplication.postEntry(tx, {
        company,
        journalType: data.journalType,
        date: data.date,
        label: data.label,
        reference: data.reference,
        originType: "manual",
        lines: data.lines.map((line) => ({
          // A manual entry names an explicit account: the logical key is never
          // looked up in that case.
          mappingKey: "ROUNDING_DIFFERENCE",
          accountId: line.accountId,
          debitCents: line.debitCents,
          creditCents: line.creditCents,
          label: line.label || data.label,
          partyId: line.partyId ?? null,
        })),
      })
    );
  }

  async listFiscalYears(companyId: string) {
    return fiscalYearsRepository.listAll(companyId, { orderBy: [asc(fiscalYears.startDate)] });
  }

  async createFiscalYear(companyId: string, body: unknown) {
    const data = createFiscalYearSchema.parse(body);
    if (data.endDate <= data.startDate) {
      throw new BusinessRuleError("The end date must be after the start date.");
    }
    return fiscalYearsRepository.create(companyId, data);
  }

  async closeFiscalYear(companyId: string, id: unknown) {
    const { id: fiscalYearId } = idParamSchema.parse({ id });
    const year = await fiscalYearsRepository.update(companyId, fiscalYearId, { isClosed: true });
    if (!year) throw new NotFoundError("Fiscal year not found.");
    return year;
  }
}

export const accountingService = new AccountingService();
