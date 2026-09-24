/** Application boundary of treasury. */

import { asc } from "drizzle-orm";

import { bankAccounts } from "@shared/schema";
import { runInTransaction } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { bankingApplication } from "./application";
import { bankAccountsRepository, bankingRepository } from "./repository";
import {
  createBankAccountSchema,
  createTransactionSchema,
  idParamSchema,
  listTransactionsQuerySchema,
  reconcileSchema,
  transferSchema,
  updateBankAccountSchema,
} from "./schemas";

export class BankingService {
  async listAccounts(companyId: string) {
    return bankAccountsRepository.listAll(companyId, { orderBy: [asc(bankAccounts.name)] });
  }

  async getAccount(companyId: string, id: unknown) {
    const { id: accountId } = idParamSchema.parse({ id });
    return bankAccountsRepository.requireById(companyId, accountId);
  }

  async createAccount(companyId: string, body: unknown) {
    return bankAccountsRepository.create(companyId, createBankAccountSchema.parse(body));
  }

  async updateAccount(companyId: string, id: unknown, body: unknown) {
    const { id: accountId } = idParamSchema.parse({ id });
    const account = await bankAccountsRepository.update(
      companyId,
      accountId,
      updateBankAccountSchema.parse(body)
    );
    if (!account) throw new NotFoundError("Cash/bank account not found.");
    return account;
  }

  async archiveAccount(companyId: string, id: unknown) {
    const { id: accountId } = idParamSchema.parse({ id });
    const archived = await bankAccountsRepository.archive(companyId, accountId);
    if (!archived) throw new NotFoundError("Cash/bank account not found.");
    return { success: true as const };
  }

  async listTransactions(companyId: string, query: unknown) {
    return bankingRepository.listTransactions(
      companyId,
      listTransactionsQuerySchema.parse(query ?? {})
    );
  }

  async createTransaction(companyId: string, body: unknown) {
    const data = createTransactionSchema.parse(body);
    await bankAccountsRepository.requireById(companyId, data.bankAccountId);
    return runInTransaction((tx) => bankingApplication.recordMovement(tx, { companyId, ...data }));
  }

  async transfer(companyId: string, body: unknown) {
    const data = transferSchema.parse(body);
    await Promise.all([
      bankAccountsRepository.requireById(companyId, data.fromAccountId),
      bankAccountsRepository.requireById(companyId, data.toAccountId),
    ]);
    return bankingApplication.transfer({ companyId, ...data });
  }

  async setReconciled(companyId: string, id: unknown, body: unknown) {
    const { id: transactionId } = idParamSchema.parse({ id });
    const { reconciled } = reconcileSchema.parse(body);
    const transaction = await bankingRepository.setReconciled(companyId, transactionId, reconciled);
    if (!transaction) throw new NotFoundError("Transaction not found.");
    return transaction;
  }

  async totals(companyId: string) {
    return bankingApplication.treasuryTotals(companyId);
  }
}

export const bankingService = new BankingService();
