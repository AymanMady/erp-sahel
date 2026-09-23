/**
 * Moteur d'écritures : transforme des **clés logiques** en écriture équilibrée et
 * la persiste dans la transaction du document appelant ([FR-CPT-1], [BR-7]).
 *
 * Aucun numéro de compte n'est écrit en dur ici : la résolution passe par
 * `account_mappings`, ce qui rend le référentiel comptable interchangeable ([BR-21]).
 */

import { assertBalanced, chartTemplateFor, type PostingLine } from "@shared/accounting-rules";
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

class AccountingApplication {
  /**
   * Résout une clé logique vers un compte. Une clé non mappée est une erreur de
   * configuration, pas une donnée manquante : mieux vaut bloquer la validation que
   * produire une écriture imputée au mauvais compte.
   */
  private resolveAccountId(
    mappings: Map<AccountMappingKey, string>,
    line: PostingLine,
    standard: Company["accountingStandard"]
  ): string {
    if (line.accountId) return line.accountId;
    const accountId = mappings.get(line.mappingKey);
    if (accountId) return accountId;
    const template = chartTemplateFor(standard);
    const suggestion = template.accounts.find((a) => a.mappingKey === line.mappingKey);
    throw new BusinessRuleError(
      `Comptabilité non configurée : aucun compte n'est associé à « ${line.mappingKey} »` +
        (suggestion ? ` (attendu : ${suggestion.code} — ${suggestion.name}).` : "."),
      "ACCOUNT_MAPPING_MISSING",
      { mappingKey: line.mappingKey }
    );
  }

  /**
   * Crée l'écriture. Idempotent par origine : si une écriture existe déjà pour le
   * couple (origine, identifiant), elle est renvoyée telle quelle — rejouer une
   * ingestion de synchronisation ne peut donc pas comptabiliser deux fois ([BR-8]).
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
      throw new BusinessRuleError("Une écriture doit comporter au moins une ligne mouvementée.");
    }
    const { totalDebitCents, totalCreditCents } = assertBalanced(relevantLines);

    const journal = await repository.findJournalByType(input.company.id, input.journalType);
    if (!journal) {
      throw new BusinessRuleError(
        `Aucun journal de type « ${input.journalType} » n'est configuré pour cette société.`,
        "JOURNAL_MISSING"
      );
    }

    // Séquentiel : ces trois requêtes partagent la connexion de la transaction.
    const mappings = await repository.loadMappings(input.company.id);
    const fiscalYear = await repository.findFiscalYearFor(input.company.id, input.date);

    if (fiscalYear?.isClosed) {
      throw new BusinessRuleError(
        `L'exercice ${fiscalYear.name} est clôturé : aucune écriture ne peut y être ajoutée.`,
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

  /** Installe le plan comptable et les journaux d'une société à sa création. */
  async installChartOfAccounts(
    tx: Database,
    company: Pick<Company, "id" | "accountingStandard">
  ): Promise<void> {
    const template = chartTemplateFor(company.accountingStandard);
    const repository = accountingRepository.withTransaction(tx);

    // Les comptes parents doivent exister avant leurs enfants : on trie par longueur
    // de code, ce qui reproduit la hiérarchie du plan (10 avant 101).
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
