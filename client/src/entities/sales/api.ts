/** Accès API des devis et commandes de vente. */

import { api } from "@/shared/api/http";
import type {
  InvoiceDetail,
  Paginated,
  Quote,
  QuoteDetail,
  SalesOrder,
  SalesOrderDetail,
} from "@/entities/types";

export interface SalesFilters {
  search?: string;
  status?: string | null;
  partyId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  limit?: number;
  offset?: number;
}

export const salesApi = {
  listQuotes: (filters: SalesFilters = {}) =>
    api.get<Paginated<Quote & { partyName: string }>>("/api/quotes", filters),
  getQuote: (id: string) => api.get<QuoteDetail>(`/api/quotes/${id}`),
  createQuote: (body: unknown) => api.post<QuoteDetail>("/api/quotes", body),
  updateQuote: (id: string, body: unknown) => api.patch<QuoteDetail>(`/api/quotes/${id}`, body),
  setQuoteStatus: (id: string, status: string) =>
    api.patch<Quote>(`/api/quotes/${id}/status`, { status }),
  convertQuote: (id: string) => api.post<SalesOrderDetail>(`/api/quotes/${id}/convert`),

  listOrders: (filters: SalesFilters = {}) =>
    api.get<Paginated<SalesOrder & { partyName: string }>>("/api/sales-orders", filters),
  getOrder: (id: string) => api.get<SalesOrderDetail>(`/api/sales-orders/${id}`),
  createOrder: (body: unknown) => api.post<SalesOrderDetail>("/api/sales-orders", body),
  setOrderStatus: (id: string, status: string) =>
    api.patch<SalesOrder>(`/api/sales-orders/${id}/status`, { status }),
  invoiceOrder: (id: string) => api.post<InvoiceDetail>(`/api/sales-orders/${id}/invoice`),
};
