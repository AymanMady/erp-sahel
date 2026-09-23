/** Accès API des règlements. */

import { api } from "@/shared/api/http";
import type { Paginated, PaymentRow } from "@/entities/types";

export interface PaymentFilters {
  partyId?: string | null;
  invoiceId?: string | null;
  posSessionId?: string | null;
  direction?: "IN" | "OUT" | null;
  method?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  limit?: number;
  offset?: number;
}

export const paymentApi = {
  list: (filters: PaymentFilters = {}) => api.get<Paginated<PaymentRow>>("/api/payments", filters),
  get: (id: string) => api.get<PaymentRow>(`/api/payments/${id}`),
  create: (body: unknown) => api.post<PaymentRow>("/api/payments", body),
};
