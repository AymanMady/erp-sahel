/**
 * Configuration de TanStack Query.
 *
 * Deux choix dictés par le mode hors ligne :
 *  - `staleTime` généreux et `gcTime` très long : les listes déjà chargées restent
 *    affichables quand le réseau tombe, au lieu de vider l'écran ;
 *  - aucun `retry` sur les erreurs réseau : réessayer trois fois ne ramène pas le
 *    réseau, cela ne fait que retarder l'affichage du mode hors ligne.
 */

import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./api-error";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.isNetworkError) return false;
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

/** Clés de requête centralisées : évite les invalidations manquées ou trop larges. */
export const queryKeys = {
  session: ["session"] as const,
  dashboard: (period?: unknown) => ["dashboard", period ?? null] as const,
  company: ["company"] as const,
  modules: ["modules"] as const,
  parties: (filters?: unknown) => ["parties", filters ?? null] as const,
  party: (id: string) => ["party", id] as const,
  products: (filters?: unknown) => ["products", filters ?? null] as const,
  product: (id: string) => ["product", id] as const,
  categories: ["categories"] as const,
  services: (filters?: unknown) => ["services", filters ?? null] as const,
  stock: (filters?: unknown) => ["stock", filters ?? null] as const,
  movements: (filters?: unknown) => ["movements", filters ?? null] as const,
  warehouses: ["warehouses"] as const,
  quotes: (filters?: unknown) => ["quotes", filters ?? null] as const,
  quote: (id: string) => ["quote", id] as const,
  salesOrders: (filters?: unknown) => ["sales-orders", filters ?? null] as const,
  salesOrder: (id: string) => ["sales-order", id] as const,
  invoices: (filters?: unknown) => ["invoices", filters ?? null] as const,
  invoice: (id: string) => ["invoice", id] as const,
  creditNotes: (filters?: unknown) => ["credit-notes", filters ?? null] as const,
  payments: (filters?: unknown) => ["payments", filters ?? null] as const,
  purchaseOrders: (filters?: unknown) => ["purchase-orders", filters ?? null] as const,
  purchaseOrder: (id: string) => ["purchase-order", id] as const,
  goodsReceipts: (filters?: unknown) => ["goods-receipts", filters ?? null] as const,
  supplierInvoices: (filters?: unknown) => ["supplier-invoices", filters ?? null] as const,
  bankAccounts: ["bank-accounts"] as const,
  bankTransactions: (filters?: unknown) => ["bank-transactions", filters ?? null] as const,
  treasury: ["treasury"] as const,
  posRegisters: ["pos-registers"] as const,
  posSessions: (filters?: unknown) => ["pos-sessions", filters ?? null] as const,
  posCurrentSession: ["pos-current-session"] as const,
  accounts: ["accounts"] as const,
  journals: ["journals"] as const,
  accountMappings: ["account-mappings"] as const,
  entries: (filters?: unknown) => ["entries", filters ?? null] as const,
  ledger: (filters?: unknown) => ["ledger", filters ?? null] as const,
  balance: (filters?: unknown) => ["balance", filters ?? null] as const,
  fiscalYears: ["fiscal-years"] as const,
  users: ["users"] as const,
  roles: ["roles"] as const,
  permissions: ["permissions"] as const,
  reports: (kind: string, filters?: unknown) => ["reports", kind, filters ?? null] as const,
  syncStatus: ["sync-status"] as const,
} as const;
