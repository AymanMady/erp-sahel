/** Accès API de la comptabilité. */

import { api } from "@/shared/api/http";
import type {
  Account,
  AccountMappingKey,
  BalanceRow,
  EntryWithLines,
  FiscalYear,
  Journal,
  LedgerRow,
} from "@/entities/types";

export const accountingApi = {
  listAccounts: () => api.get<Account[]>("/api/accounting/accounts"),
  createAccount: (body: unknown) => api.post<Account>("/api/accounting/accounts", body),
  updateAccount: (id: string, body: unknown) =>
    api.patch<Account>(`/api/accounting/accounts/${id}`, body),
  archiveAccount: (id: string) => api.delete(`/api/accounting/accounts/${id}`),

  listJournals: () => api.get<Journal[]>("/api/accounting/journals"),
  createJournal: (body: unknown) => api.post<Journal>("/api/accounting/journals", body),
  updateJournal: (id: string, body: unknown) =>
    api.patch<Journal>(`/api/accounting/journals/${id}`, body),

  listMappings: () =>
    api.get<{ key: AccountMappingKey; accountId: string }[]>("/api/accounting/mappings"),
  setMapping: (key: AccountMappingKey, accountId: string) =>
    api.put("/api/accounting/mappings", { key, accountId }),

  listEntries: (
    filters: {
      journalId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    } = {}
  ) => api.get<{ items: EntryWithLines[]; total: number }>("/api/accounting/entries", filters),
  createEntry: (body: unknown) => api.post("/api/accounting/entries", body),

  ledger: (
    filters: {
      accountId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    } = {}
  ) => api.get<{ items: LedgerRow[]; total: number }>("/api/accounting/ledger", filters),

  balance: (filters: { fromDate?: string | null; toDate?: string | null } = {}) =>
    api.get<{ items: BalanceRow[]; totals: { debitCents: number; creditCents: number } }>(
      "/api/accounting/balance",
      filters
    ),

  listFiscalYears: () => api.get<FiscalYear[]>("/api/accounting/fiscal-years"),
  createFiscalYear: (body: unknown) => api.post<FiscalYear>("/api/accounting/fiscal-years", body),
  closeFiscalYear: (id: string) => api.post(`/api/accounting/fiscal-years/${id}/close`),
};
