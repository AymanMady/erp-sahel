/** Inventory API access. */

import { api } from "@/shared/api/http";
import {
  listStockOffline,
  lowStockOffline,
  withOfflineFallback,
} from "@/shared/offline/offline-reads";
import {
  listStockLocal,
  listWarehousesLocal,
  lowStockLocal,
  readLocalFirst,
} from "@/shared/offline/local/local-reads";
import type { MovementRow, Paginated, StockRow, Warehouse } from "@/entities/types";

export interface StockFilters {
  warehouseId?: string | null;
  productId?: string | null;
  search?: string;
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface MovementFilters {
  productId?: string | null;
  warehouseId?: string | null;
  originType?: string | null;
  limit?: number;
  offset?: number;
}

export const inventoryApi = {
  // Offline-first desktop: from the local database once downloaded (`local-reads.ts`).
  listStock: (filters: StockFilters = {}) =>
    readLocalFirst(
      ["stock_items", "products", "warehouses"],
      () => listStockLocal(filters),
      () =>
        withOfflineFallback<{ items: StockRow[]; total: number }>(
          () => api.get<{ items: StockRow[]; total: number }>("/api/inventory/stock", filters),
          (snapshot) => listStockOffline(snapshot, filters)
        )
    ),
  listMovements: (filters: MovementFilters = {}) =>
    api.get<{ items: MovementRow[]; total: number }>("/api/inventory/movements", filters),
  createMovement: (body: unknown) => api.post("/api/inventory/movements", body),
  transfer: (body: unknown) => api.post("/api/inventory/transfer", body),
  valuation: (warehouseId?: string | null) =>
    api.get<{ totalQuantity: number; totalValueCents: number; skuCount: number }>(
      "/api/inventory/valuation",
      { warehouseId }
    ),
  lowStock: () =>
    readLocalFirst(["products", "stock_items"], lowStockLocal, () =>
      withOfflineFallback(
        () =>
          api.get<
            { productId: string; sku: string; name: string; minStock: string; quantity: string }[]
          >("/api/inventory/low-stock"),
        lowStockOffline
      )
    ),

  listWarehouses: () =>
    readLocalFirst(["warehouses"], listWarehousesLocal, () =>
      withOfflineFallback(
        () => api.get<Warehouse[]>("/api/warehouses"),
        (snapshot) => snapshot.warehouses
      )
    ),
  createWarehouse: (body: unknown) => api.post<Warehouse>("/api/warehouses", body),
  updateWarehouse: (id: string, body: unknown) =>
    api.patch<Warehouse>(`/api/warehouses/${id}`, body),
  archiveWarehouse: (id: string) => api.delete(`/api/warehouses/${id}`),
};

export type { Paginated };
