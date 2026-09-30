/** Parties (customers/suppliers) API access. */

import { api, apiRequest } from "@/shared/api/http";
import {
  listPartiesOffline,
  partyDetailOffline,
  withOfflineFallback,
} from "@/shared/offline/offline-reads";
import { offlineNotFound } from "@/shared/api/api-error";
import { i18n } from "@/shared/i18n";
import { pendingParties } from "@/shared/offline/offline-writes";
import {
  getPartyLocal,
  listPartiesLocal,
  readLocalFirst,
} from "@/shared/offline/local/local-reads";
import {
  archiveLocal,
  createLocal,
  updateLocal,
  writeLocalFirst,
} from "@/shared/offline/local/local-writes";
import type {
  Contact,
  ImportResult,
  Paginated,
  Party,
  PartyAddress,
  PartyDetail,
} from "@/entities/types";

export interface PartyFilters {
  search?: string;
  partyType?: string | null;
  role?: "CUSTOMER" | "SUPPLIER" | null;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export const partyApi = {
  // Offline-first desktop: from the local database once downloaded (`local-reads.ts`).
  list: (filters: PartyFilters = {}) =>
    readLocalFirst(
      ["parties"],
      () => listPartiesLocal(filters),
      () =>
        withOfflineFallback(
          () => api.get<Paginated<Party>>("/api/parties", filters),
          async (snapshot) => listPartiesOffline(snapshot, await pendingParties(), filters)
        )
    ),
  get: (id: string) =>
    readLocalFirst(
      // The detail shows the customer's invoices, payments and balance.
      ["parties", "sales_invoices", "payments"],
      () => getPartyLocal(id),
      () =>
        withOfflineFallback(
          () => api.get<PartyDetail>(`/api/parties/${id}`),
          async (snapshot) => {
            const detail = partyDetailOffline(snapshot, id, await pendingParties());
            if (!detail) throw offlineNotFound(i18n.t("parties:offlineUnavailable"));
            return detail as PartyDetail;
          }
        )
    ),
  // Offline-first desktop: written here and queued, in one transaction (`local-writes.ts`).
  create: (body: unknown) =>
    writeLocalFirst(
      "parties",
      () => createLocal<Party>("parties", body as Record<string, unknown>),
      () => api.post<Party>("/api/parties", body)
    ),
  update: (id: string, body: unknown) =>
    writeLocalFirst(
      "parties",
      () => updateLocal<Party>("parties", id, body as Record<string, unknown>),
      () => api.patch<Party>(`/api/parties/${id}`, body)
    ),
  archive: (id: string) =>
    writeLocalFirst(
      "parties",
      () => archiveLocal("parties", id),
      () => api.delete<{ success: true }>(`/api/parties/${id}`)
    ),

  createContact: (partyId: string, body: unknown) =>
    api.post<Contact>(`/api/parties/${partyId}/contacts`, body),
  updateContact: (contactId: string, body: unknown) =>
    api.patch<Contact>(`/api/parties/contacts/${contactId}`, body),
  archiveContact: (contactId: string) => api.delete(`/api/parties/contacts/${contactId}`),

  createAddress: (partyId: string, body: unknown) =>
    api.post<PartyAddress>(`/api/parties/${partyId}/addresses`, body),
  updateAddress: (addressId: string, body: unknown) =>
    api.patch<PartyAddress>(`/api/parties/addresses/${addressId}`, body),
  archiveAddress: (addressId: string) => api.delete(`/api/parties/addresses/${addressId}`),

  /** Excel file of every customer and supplier; also the model to fill in for an import. */
  exportAll: () => apiRequest<Blob>("/api/parties/export", { responseType: "blob" }),
  /** Needs the server: a whole file is never kept for later. */
  importAll: (file: File) =>
    apiRequest<ImportResult>("/api/parties/import", {
      method: "POST",
      body: file,
      queueOffline: false,
    }),
};
