/** Accès API des tiers. */

import { api } from "@/shared/api/http";
import { listPartiesOffline, withOfflineFallback } from "@/shared/offline/offline-reads";
import type { Contact, Paginated, Party, PartyAddress, PartyDetail } from "@/entities/types";

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
      (snapshot) => listPartiesOffline(snapshot, filters)
    ),
  get: (id: string) => api.get<PartyDetail>(`/api/parties/${id}`),
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
};
