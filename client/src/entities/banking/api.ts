/** Accès API de la trésorerie. */

import { api } from "@/shared/api/http";
import type { BankAccount, BankTransaction } from "@/entities/types";

export const bankingApi = {
  listAccounts: () => api.get<BankAccount[]>("/api/banking/accounts"),
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
