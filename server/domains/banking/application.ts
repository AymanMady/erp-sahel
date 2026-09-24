/**
 * Treasury orchestration.
 *
 * Every balance change goes through `recordMovement`: the displayed balance is then
 * always the sum of the movements, which makes bank reconciliation possible
 * ([FR-PAY-3]).
 */

import type { BankAccount, BankTransaction, PaymentMethod } from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { tr } from "../../shared/i18n";
import { bankAccountsRepository, bankingRepository } from "./repository";

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

  /** Internal transfer: a linked withdrawal and deposit, in a single transaction. */
  async transfer(input: {
    companyId: string;
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
    return runInTransaction(async (tx) => {
      const description = input.description ?? tr("Internal transfer");
      const from = await this.recordMovement(tx, {
        companyId: input.companyId,
        bankAccountId: input.fromAccountId,
        date: input.date,
        description,
        transactionType: "WITHDRAWAL",
        amountCents: input.amountCents,
        reference: input.reference,
        counterpartAccountId: input.toAccountId,
      });
      const to = await this.recordMovement(tx, {
        companyId: input.companyId,
        bankAccountId: input.toAccountId,
        date: input.date,
        description,
        transactionType: "DEPOSIT",
        amountCents: input.amountCents,
        reference: input.reference,
        counterpartAccountId: input.fromAccountId,
      });
      return { from, to };
    });
  }

  async treasuryTotals(companyId: string) {
    return bankingRepository.treasuryTotals(companyId);
  }
}

export const bankingApplication = new BankingApplication();
