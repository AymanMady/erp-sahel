/** Dashboard and reports API access. */

import { api } from "@/shared/api/http";
import type { DashboardData } from "@/entities/types";

export interface PeriodFilter {
  fromDate?: string | null;
  toDate?: string | null;
}

export interface SalesReport {
  period: { fromDate: string; toDate: string };
  summary: DashboardData["sales"];
  daily: DashboardData["dailyRevenue"];
  topProducts: DashboardData["topProducts"];
  collections: { paymentMethod: string; totalCents: number; count: number }[];
}

export const reportsApi = {
  dashboard: (period: PeriodFilter = {}) => api.get<DashboardData>("/api/dashboard", period),
  sales: (period: PeriodFilter = {}) => api.get<SalesReport>("/api/reports/sales", period),
  stock: (warehouseId?: string | null) =>
    api.get<{
      valuation: DashboardData["stock"];
      lowStock: DashboardData["lowStock"];
    }>("/api/reports/stock", { warehouseId }),
  purchases: (period: PeriodFilter = {}) =>
    api.get<{ period: { fromDate: string; toDate: string }; summary: DashboardData["purchases"] }>(
      "/api/reports/purchases",
      period
    ),
};
