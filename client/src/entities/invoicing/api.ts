/** API access for customer invoicing. */

import { api } from "@/shared/api/http";
import type {
  CreditNote,
  CreditNoteLine,
  InvoiceDetail,
  InvoiceListItem,
  Paginated,
} from "@/entities/types";

export interface InvoiceFilters {
  search?: string;
  status?: string | null;
  source?: string | null;
  partyId?: string | null;
  posSessionId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  unpaidOnly?: boolean;
  limit?: number;
  offset?: number;
}

export const invoicingApi = {
  list: (filters: InvoiceFilters = {}) =>
    api.get<Paginated<InvoiceListItem>>("/api/invoices", filters),
  get: (id: string) => api.get<InvoiceDetail>(`/api/invoices/${id}`),
  create: (body: unknown) => api.post<InvoiceDetail>("/api/invoices", body),
  update: (id: string, body: unknown) => api.patch<InvoiceDetail>(`/api/invoices/${id}`, body),
  validate: (id: string) => api.post<InvoiceDetail>(`/api/invoices/${id}/validate`),
  cancelDraft: (id: string) => api.delete(`/api/invoices/${id}`),

  listCreditNotes: (filters: { invoiceId?: string | null; limit?: number; offset?: number } = {}) =>
    api.get<Paginated<CreditNote & { partyName: string }>>("/api/credit-notes", filters),
  getCreditNote: (id: string) =>
    api.get<CreditNote & { partyName: string; lines: CreditNoteLine[] }>(`/api/credit-notes/${id}`),
  createCreditNote: (body: unknown) => api.post("/api/credit-notes", body),
};
