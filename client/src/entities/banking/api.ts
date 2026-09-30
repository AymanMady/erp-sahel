/** Treasury (banking) API access. */

import { api } from "@/shared/api/http";
import { listPaymentAccountsLocal, readLocalFirst } from "@/shared/offline/local/local-reads";
import type { BankAccount, BankTransaction } from "@/entities/types";

/** Where a payment can land — readable by cashiers, so without the balance. */
export type PaymentAccount = Pick<
  BankAccount,
  "id" | "code" | "name" | "accountType" | "isDefault"
>;

export const bankingApi = {
  listAccounts: () => api.get<BankAccount[]>("/api/banking/accounts"),
  listPaymentAccounts: () =>
    readLocalFirst(
      ["bank_accounts"],
      () => listPaymentAccountsLocal() as Promise<PaymentAccount[]>,
      () => api.get<PaymentAccount[]>("/api/banking/payment-accounts")
    ),
  createAccount: (body: unknown) => api.post<BankAccount>("/api/banking/accounts", body),
  updateAccount: (id: string, body: unknown) =>
    api.patch<BankAccount>(`/api/banking/accounts/${id}`, body),
  archiveAccount: (id: string) => api.delete(`/api/banking/accounts/${id}`),

  listTransactions: (
    filters: {
      bankAccountId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      reconciled?: boolean | null;
      limit?: number;
      offset?: number;
    } = {}
  ) => api.get<{ items: BankTransaction[]; total: number }>("/api/banking/transactions", filters),
  createTransaction: (body: unknown) =>
    api.post<BankTransaction>("/api/banking/transactions", body),
  transfer: (body: unknown) => api.post("/api/banking/transfer", body),
  setReconciled: (id: string, reconciled: boolean) =>
    api.patch<BankTransaction>(`/api/banking/transactions/${id}/reconcile`, { reconciled }),
  totals: () =>
    api.get<{ cashCents: number; bankCents: number; mobileCents: number; totalCents: number }>(
      "/api/banking/totals"
    ),
};
