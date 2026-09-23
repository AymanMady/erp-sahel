/**
 * Orchestration de la trésorerie.
 *
 * Toute variation de solde passe par `recordMovement` : le solde affiché est alors
 * toujours la somme des mouvements, et le rapprochement bancaire devient possible
 * ([FR-PAY-3]).
 */

import type { BankAccount, BankTransaction, PaymentMethod } from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import { BusinessRuleError, NotFoundError } from "../../shared/errors/app-error";
import { bankAccountsRepository, bankingRepository } from "./repository";

/** Type de compte correspondant à un mode de règlement. */
function accountTypeFor(method: PaymentMethod): BankAccount["accountType"] {
  if (method === "CASH") return "CASH";
  if (method === "MOBILE_MONEY") return "MOBILE_MONEY";
  return "BANK";
}

class BankingApplication {
  /**
   * Compte de trésorerie à mouvementer : celui demandé, sinon le compte par défaut du
   * type correspondant au mode de règlement. Sans compte disponible, on refuse plutôt
   * que d'enregistrer un encaissement « hors trésorerie ».
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
      if (!account) throw new NotFoundError("Compte de trésorerie introuvable.");
      return account as BankAccount;
    }
    const repository = database ? bankingRepository.withTransaction(database) : bankingRepository;
    const fallback = await repository.findDefaultFor(companyId, accountTypeFor(input.method));
    if (!fallback) {
      throw new BusinessRuleError(
        "Aucun compte de trésorerie n'est configuré pour ce mode de règlement. " +
          "Créez-en un dans Trésorerie › Comptes.",
        "NO_TREASURY_ACCOUNT"
      );
    }
    return fallback;
  }

  /** Enregistre un mouvement et ajuste le solde dans la même transaction. */
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
      throw new BusinessRuleError("Le montant d'un mouvement doit être strictement positif.");
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

  /** Virement interne : un retrait et un dépôt liés, dans une seule transaction. */
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
      throw new BusinessRuleError("Les comptes source et destination doivent différer.");
    }
    return runInTransaction(async (tx) => {
      const description = input.description ?? "Virement interne";
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
