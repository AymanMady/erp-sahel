/** Point of sale API access. */

import { api } from "@/shared/api/http";
import { withOfflineFallback } from "@/shared/offline/offline-reads";
import type { InvoiceDetail, PosRegister, PosSession } from "@/entities/types";

export interface SessionSummary extends PosSession {
  totals: {
    byMethod: { paymentMethod: string; totalCents: number; count: number }[];
    totalCents: number;
    cashCents: number;
  };
  expectedBalanceCents: number;
  differenceCents: number;
}

export const posApi = {
  listRegisters: () =>
    withOfflineFallback(
      () => api.get<PosRegister[]>("/api/pos/registers"),
      (snapshot) => snapshot.registers
    ),
  createRegister: (body: unknown) => api.post<PosRegister>("/api/pos/registers", body),
  updateRegister: (id: string, body: unknown) =>
    api.patch<PosRegister>(`/api/pos/registers/${id}`, body),
  archiveRegister: (id: string) => api.delete(`/api/pos/registers/${id}`),

  listSessions: (filters: { registerId?: string | null; status?: string | null } = {}) =>
    api.get<(PosSession & { registerName: string; registerCode: string; userName: string })[]>(
      "/api/pos/sessions",
      filters
    ),
  currentSession: () =>
    withOfflineFallback(
      () => api.get<PosSession | null>("/api/pos/sessions/current"),
      (snapshot) => snapshot.session
    ),
  sessionSummary: (id: string) => api.get<SessionSummary>(`/api/pos/sessions/${id}`),
  openSession: (body: unknown) => api.post<PosSession>("/api/pos/sessions", body),
  closeSession: (id: string, body: unknown) =>
    api.post<PosSession & { differenceCents: number }>(`/api/pos/sessions/${id}/close`, body),

  createTicket: (body: unknown) =>
    api.post<{ invoice: InvoiceDetail; session: PosSession }>("/api/pos/tickets", body),
};
