/**
 * Treasury orchestration.
 *
 * Every balance change goes through `recordMovement`: the displayed balance is then
 * always the sum of the movements, which makes bank reconciliation possible
 * ([FR-PAY-3]).
 */

import {
  buildCashDifferencePosting,
  buildTreasuryMovementPosting,
  buildTreasuryTransferPosting,
} from "@shared/accounting-rules";
import type {
  BankAccount,
  BankTransaction,
  Company,
  JournalEntry,
  PaymentMethod,
} from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { accountingApplication } from "../accounting/application";
import { bankAccountsRepository, bankingRepository } from "./repository";

/** What the posting engine needs to know about the company. */
type PostingCompany = Pick<Company, "id" | "fiscalYearStartMonth" | "accountingStandard">;

/** Cash movements go to the cash journal, the others to the bank journal. */
function journalFor(account: BankAccount): "CASH" | "BANK" {
  return account.accountType === "CASH" ? "CASH" : "BANK";
}

/** Account type matching a payment method. */
function accountTypeFor(method: PaymentMethod): BankAccount["accountType"] {
  if (method === "CASH") return "CASH";
  if (method === "MOBILE_MONEY") return "MOBILE_MONEY";
  return "BANK";
}

class BankingApplication {
  /**
   * Treasury account to move: the requested one, otherwise the default account of the
   * type matching the payment method. Without an available account the operation is
   * refused rather than recording a receipt "outside treasury".
   */
  async resolveAccount(
    companyId: string,
    input: { bankAccountId?: string | null; method: PaymentMethod },
    database?: Database
  ): Promise<BankAccount> {
    if (input.bankAccountId) {
      const repository = database
        ? bankAccountsRepository.withTransaction(database)
        : bankAccountsRepository;
      const account = await repository.findById(companyId, input.bankAccountId);
      if (!account) throw new NotFoundError("Cash/bank account not found.");
      return account as BankAccount;
    }
    const repository = database ? bankingRepository.withTransaction(database) : bankingRepository;
    const fallback = await repository.findDefaultFor(companyId, accountTypeFor(input.method));
    if (!fallback) {
      throw new BusinessRuleError(
        "No cash/bank account is configured for this payment method. Create one in Treasury › Accounts.",
        "NO_TREASURY_ACCOUNT"
      );
    }
    return fallback;
  }

  /** Records a movement and adjusts the balance in the same transaction. */
  async recordMovement(
    tx: Database,
    input: {
      companyId: string;
      bankAccountId: string;
      date: string;
      description: string;
      transactionType: BankTransaction["transactionType"];
      amountCents: number;
      reference?: string;
      paymentId?: string | null;
      counterpartAccountId?: string | null;
      reconciled?: boolean;
    }
  ): Promise<BankTransaction> {
    if (input.amountCents <= 0) {
      throw new BusinessRuleError("A movement amount must be strictly positive.");
    }
    const repository = bankingRepository.withTransaction(tx);
    const transaction = await repository.insertTransaction({
      companyId: input.companyId,
      bankAccountId: input.bankAccountId,
      counterpartAccountId: input.counterpartAccountId ?? null,
      date: input.date,
      description: input.description,
      transactionType: input.transactionType,
      amountCents: input.amountCents,
      reference: input.reference ?? "",
      reconciled: input.reconciled ?? false,
      paymentId: input.paymentId ?? null,
    });
    const delta = input.transactionType === "WITHDRAWAL" ? -input.amountCents : input.amountCents;
    await repository.applyBalanceDelta(input.companyId, input.bankAccountId, delta);
    return transaction;
  }

  private async requireAccountInTx(
    tx: Database,
    companyId: string,
    bankAccountId: string
  ): Promise<BankAccount> {
    const account = await bankAccountsRepository
      .withTransaction(tx)
      .findById(companyId, bankAccountId);
    if (!account) throw new NotFoundError("Cash/bank account not found.");
    return account as BankAccount;
  }

  /**
   * Money put in or taken out by hand (not a customer or supplier payment): the balance
   * moves and a matching accounting entry is posted in the same transaction, so the
   * treasury and the books never drift apart. The other side of the entry is the chart
   * account chosen by the user, otherwise the suspense account (471).
   */
  async recordManualMovement(input: {
    company: PostingCompany;
    bankAccountId: string;
    date: string;
    description: string;
    transactionType: BankTransaction["transactionType"];
    amountCents: number;
    reference?: string;
    counterpartGlAccountId?: string | null;
  }): Promise<BankTransaction> {
    return runInTransaction(async (tx) => {
      const account = await this.requireAccountInTx(tx, input.company.id, input.bankAccountId);
      if (input.counterpartGlAccountId) {
        await accountingApplication.requirePostableAccount(
          input.company.id,
          input.counterpartGlAccountId,
          tx
        );
      }
      const transaction = await this.recordMovement(tx, {
        companyId: input.company.id,
        bankAccountId: account.id,
        date: input.date,
        description: input.description,
        transactionType: input.transactionType,
        amountCents: input.amountCents,
        reference: input.reference,
      });
      await accountingApplication.postEntry(tx, {
        company: input.company,
        journalType: journalFor(account),
        date: input.date,
        label: input.description,
        reference: input.reference ?? "",
        originType: "bank_transaction",
        originId: transaction.id,
        lines: buildTreasuryMovementPosting({
          account,
          direction: input.transactionType === "WITHDRAWAL" ? "OUT" : "IN",
          amountCents: input.amountCents,
          counterpartAccountId: input.counterpartGlAccountId ?? null,
          label: input.description,
        }),
      });
      return transaction;
    });
  }

  /**
   * Difference found when the till is counted at closing (counted − expected).
   * Brings the cash account balance to the counted amount and posts the entry:
   * surplus → miscellaneous income (758), shortage → miscellaneous expenses (658).
   *
   * Meant to be called by the register closing, inside its transaction. Idempotent per
   * `originId` (the register session): calling it twice changes nothing. Returns `null`
   * when there is no difference or when it was already recorded.
   */
  async postCashDifference(
    tx: Database,
    input: {
      company: PostingCompany;
      /** Cash account of the register; the default cash account when omitted. */
      bankAccountId?: string | null;
      /** counted − expected, in cents: positive = surplus, negative = shortage. */
      differenceCents: number;
      date: string;
      /** Human reference shown on the movement and the entry (e.g. the session number). */
      reference: string;
      /** The register session id: the key that makes the call idempotent. */
      originId: string;
    }
  ): Promise<{ transaction: BankTransaction; entry: JournalEntry | null } | null> {
    if (input.differenceCents === 0) return null;
    const already = await accountingApplication.findEntryByOrigin(
      input.company.id,
      "pos_session",
      input.originId,
      tx
    );
    if (already) return null;

    const account = await this.resolveAccount(
      input.company.id,
      { bankAccountId: input.bankAccountId, method: "CASH" },
      tx
    );
    const label = tr("Till count difference {reference}", { reference: input.reference });
    const transaction = await this.recordMovement(tx, {
      companyId: input.company.id,
      bankAccountId: account.id,
      date: input.date,
      description: label,
      transactionType: input.differenceCents > 0 ? "DEPOSIT" : "WITHDRAWAL",
      amountCents: Math.abs(input.differenceCents),
      reference: input.reference,
    });
    const entry = await accountingApplication.postEntry(tx, {
      company: input.company,
      journalType: journalFor(account),
      date: input.date,
      label,
      reference: input.reference,
      originType: "pos_session",
      originId: input.originId,
      lines: buildCashDifferencePosting({
        account,
        differenceCents: input.differenceCents,
        label,
      }),
    });
    return { transaction, entry };
  }

  /**
   * Internal transfer: a linked withdrawal and deposit, plus the accounting entry
   * (debit destination, credit source), in a single transaction.
   */
  async transfer(input: {
    company: PostingCompany;
    fromAccountId: string;
    toAccountId: string;
    amountCents: number;
    date: string;
    description?: string;
    reference?: string;
  }): Promise<{ from: BankTransaction; to: BankTransaction }> {
    if (input.fromAccountId === input.toAccountId) {
      throw new BusinessRuleError("The source and destination accounts must differ.");
    }
    const companyId = input.company.id;
    return runInTransaction(async (tx) => {
      const fromAccount = await this.requireAccountInTx(tx, companyId, input.fromAccountId);
      const toAccount = await this.requireAccountInTx(tx, companyId, input.toAccountId);
      const description = input.description ?? tr("Internal transfer");
      const from = await this.recordMovement(tx, {
        companyId,
        bankAccountId: input.fromAccountId,
        date: input.date,
        description,
        transactionType: "WITHDRAWAL",
        amountCents: input.amountCents,
        reference: input.reference,
        counterpartAccountId: input.toAccountId,
      });
      const to = await this.recordMovement(tx, {
        companyId,
        bankAccountId: input.toAccountId,
        date: input.date,
        description,
        transactionType: "DEPOSIT",
        amountCents: input.amountCents,
        reference: input.reference,
        counterpartAccountId: input.fromAccountId,
      });
      await accountingApplication.postEntry(tx, {
        company: input.company,
        journalType:
          journalFor(fromAccount) === "CASH" && journalFor(toAccount) === "CASH" ? "CASH" : "BANK",
        date: input.date,
        label: description,
        reference: input.reference ?? "",
        originType: "bank_transaction",
        originId: from.id,
        lines: buildTreasuryTransferPosting({
          from: fromAccount,
          to: toAccount,
          amountCents: input.amountCents,
          label: description,
        }),
      });
      return { from, to };
    });
  }

  async treasuryTotals(companyId: string) {
    return bankingRepository.treasuryTotals(companyId);
  }
}

export const bankingApplication = new BankingApplication();
