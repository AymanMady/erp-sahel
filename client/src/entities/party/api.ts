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
  list: (filters: PartyFilters = {}) =>
    withOfflineFallback(
      () => api.get<Paginated<Party>>("/api/parties", filters),
      async (snapshot) => listPartiesOffline(snapshot, await pendingParties(), filters)
    ),
  get: (id: string) =>
    withOfflineFallback(
      () => api.get<PartyDetail>(`/api/parties/${id}`),
      async (snapshot) => {
        const detail = partyDetailOffline(snapshot, id, await pendingParties());
        if (!detail) throw offlineNotFound(i18n.t("parties:offlineUnavailable"));
        return detail as PartyDetail;
      }
    ),
  create: (body: unknown) => api.post<Party>("/api/parties", body),
  update: (id: string, body: unknown) => api.patch<Party>(`/api/parties/${id}`, body),
  archive: (id: string) => api.delete<{ success: true }>(`/api/parties/${id}`),

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
