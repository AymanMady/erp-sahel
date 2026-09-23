/** Accès API du catalogue (produits, catégories, fournisseurs référencés). */

import { api } from "@/shared/api/http";
import { withOfflineFallback } from "@/shared/offline/offline-reads";
import { listProductsOffline } from "@/shared/offline/snapshot";
import type { Category, Paginated, ProductDetail, ProductListItem } from "@/entities/types";

export interface ProductFilters {
  search?: string;
  categoryId?: string | null;
  profileType?: string | null;
  isService?: boolean | null;
  includeArchived?: boolean;
  withStock?: boolean;
  orderBy?: "name" | "sku" | "price" | "recent";
  limit?: number;
  offset?: number;
  /** Critères contribués par les modules (OEM, fabricant, taille…). */
  [key: string]: unknown;
}

export const catalogApi = {
  listProducts: (filters: ProductFilters = {}) =>
    withOfflineFallback(
      () => api.get<Paginated<ProductListItem>>("/api/catalog/products", filters),
      (snapshot) =>
        listProductsOffline(snapshot, {
          search: filters.search,
          categoryId: filters.categoryId,
          isService: filters.isService,
          includeArchived: filters.includeArchived,
          orderBy: filters.orderBy,
          limit: filters.limit,
          offset: filters.offset,
          oem: typeof filters.oem === "string" ? filters.oem : undefined,
          manufacturerId:
            typeof filters.manufacturerId === "string" ? filters.manufacturerId : null,
        })
    ),
  getProduct: (id: string) => api.get<ProductDetail>(`/api/catalog/products/${id}`),
  findByBarcode: (barcode: string) =>
    api.get<ProductListItem>(`/api/catalog/products/barcode/${encodeURIComponent(barcode)}`),
  createProduct: (body: unknown) => api.post<ProductListItem>("/api/catalog/products", body),
  updateProduct: (id: string, body: unknown) =>
    api.patch<ProductListItem>(`/api/catalog/products/${id}`, body),
  archiveProduct: (id: string) => api.delete<{ success: true }>(`/api/catalog/products/${id}`),

  listCategories: () =>
    withOfflineFallback(
      () => api.get<Category[]>("/api/catalog/categories"),
      (snapshot) => snapshot.categories
    ),
  createCategory: (body: unknown) => api.post<Category>("/api/catalog/categories", body),
  updateCategory: (id: string, body: unknown) =>
    api.patch<Category>(`/api/catalog/categories/${id}`, body),
  archiveCategory: (id: string) => api.delete<{ success: true }>(`/api/catalog/categories/${id}`),

  listProductSuppliers: (productId: string) =>
    api.get<ProductDetail["suppliers"]>(`/api/catalog/products/${productId}/suppliers`),
  upsertProductSupplier: (productId: string, body: unknown) =>
    api.put(`/api/catalog/products/${productId}/suppliers`, body),
  removeProductSupplier: (productId: string, supplierId: string) =>
    api.delete(`/api/catalog/products/${productId}/suppliers/${supplierId}`),
};
