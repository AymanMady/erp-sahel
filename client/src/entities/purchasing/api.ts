/** Purchasing API access. */

import { api } from "@/shared/api/http";
import type {
  GoodsReceipt,
  GoodsReceiptLine,
  Paginated,
  PurchaseOrder,
  PurchaseOrderDetail,
  SupplierInvoice,
} from "@/entities/types";

export interface PurchaseFilters {
  search?: string;
  status?: string | null;
  supplierId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  limit?: number;
  offset?: number;
}

export const purchasingApi = {
  listOrders: (filters: PurchaseFilters = {}) =>
    api.get<Paginated<PurchaseOrder & { supplierName: string }>>("/api/purchase-orders", filters),
  getOrder: (id: string) => api.get<PurchaseOrderDetail>(`/api/purchase-orders/${id}`),
  createOrder: (body: unknown) => api.post<PurchaseOrderDetail>("/api/purchase-orders", body),
  updateOrder: (id: string, body: unknown) =>
    api.patch<PurchaseOrderDetail>(`/api/purchase-orders/${id}`, body),
  setOrderStatus: (id: string, status: string) =>
    api.patch<PurchaseOrder>(`/api/purchase-orders/${id}/status`, { status }),

  listReceipts: (purchaseOrderId?: string | null) =>
    api.get<(GoodsReceipt & { supplierName: string })[]>("/api/goods-receipts", {
      purchaseOrderId,
    }),
  getReceipt: (id: string) =>
    api.get<GoodsReceipt & { supplierName: string; lines: GoodsReceiptLine[] }>(
      `/api/goods-receipts/${id}`
    ),
  createReceipt: (body: unknown) => api.post("/api/goods-receipts", body),

  listSupplierInvoices: (filters: { supplierId?: string | null; status?: string | null } = {}) =>
    api.get<Paginated<SupplierInvoice & { supplierName: string }>>(
      "/api/supplier-invoices",
      filters
    ),
  createSupplierInvoice: (body: unknown) => api.post("/api/supplier-invoices", body),
};
