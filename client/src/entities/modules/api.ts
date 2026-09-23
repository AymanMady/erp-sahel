/** Accès API des modules métier (Auto Parts, Vêtements, Marché). */

import { api } from "@/shared/api/http";
import { withOfflineFallback } from "@/shared/offline/offline-reads";
import type { Paginated, Product } from "@/entities/types";

export interface Manufacturer {
  id: string;
  name: string;
  countryId: string | null;
  website: string;
}

export interface CountryRef {
  id: string;
  code: string;
  name: string;
}

export interface QualityLevelRef {
  id: string;
  code: string;
  label: string;
  rank: number;
}

export interface VehicleTree {
  brands: { id: string; name: string }[];
  models: { id: string; brandId: string; name: string }[];
  generations: {
    id: string;
    modelId: string;
    name: string;
    yearStart: number;
    yearEnd: number | null;
  }[];
  engines: { id: string; generationId: string; code: string; label: string; fuel: string }[];
}

export interface OemEquivalenceRow {
  id: string;
  refA: string;
  refB: string;
  normA: string;
  normB: string;
  relationType: string;
  source: string;
  note: string;
}

export interface OemSearchResult {
  equivalents: string[];
  items: {
    product: Product;
    profile: { oemReference: string; warrantyMonths: number; manufacturerRef: string };
    manufacturerName: string | null;
    countryName: string | null;
    countryCode: string | null;
    qualityLabel: string | null;
    qualityRank: number | null;
  }[];
}

export interface CompatibilityRow {
  compat: {
    id: string;
    productId: string;
    modelId: string;
    generationId: string | null;
    engineId: string | null;
    note: string;
  };
  brandName: string;
  modelName: string;
  generationName: string | null;
  engineCode: string | null;
}

const AUTO_PARTS = "/api/modules/auto-parts";

export const autoPartsApi = {
  listCountries: () =>
    withOfflineFallback(
      () => api.get<CountryRef[]>(`${AUTO_PARTS}/countries`),
      (snapshot) => snapshot.moduleData.auto_parts?.countries ?? []
    ),
  listQualityLevels: () =>
    withOfflineFallback(
      () => api.get<QualityLevelRef[]>(`${AUTO_PARTS}/quality-levels`),
      (snapshot) => snapshot.moduleData.auto_parts?.qualityLevels ?? []
    ),
  listManufacturers: () =>
    withOfflineFallback(
      () => api.get<Manufacturer[]>(`${AUTO_PARTS}/manufacturers`),
      (snapshot) =>
        (snapshot.moduleData.auto_parts?.manufacturers ?? []).map((row) => ({
          ...row,
          countryId: null,
          website: "",
        }))
    ),
  createManufacturer: (body: unknown) =>
    api.post<Manufacturer>(`${AUTO_PARTS}/manufacturers`, body),
  updateManufacturer: (id: string, body: unknown) =>
    api.patch<Manufacturer>(`${AUTO_PARTS}/manufacturers/${id}`, body),
  archiveManufacturer: (id: string) => api.delete(`${AUTO_PARTS}/manufacturers/${id}`),

  vehicleTree: () =>
    withOfflineFallback(
      () => api.get<VehicleTree>(`${AUTO_PARTS}/vehicles`),
      (snapshot) => {
        const vehicles = snapshot.moduleData.auto_parts?.vehicles;
        return {
          brands: vehicles?.brands ?? [],
          models: vehicles?.models ?? [],
          generations: vehicles?.generations ?? [],
          engines: (vehicles?.engines ?? []).map((row) => ({ ...row, fuel: "" })),
        };
      }
    ),
  createBrand: (body: unknown) => api.post(`${AUTO_PARTS}/vehicle-brands`, body),
  createModel: (body: unknown) => api.post(`${AUTO_PARTS}/vehicle-models`, body),
  createGeneration: (body: unknown) => api.post(`${AUTO_PARTS}/vehicle-generations`, body),
  createEngine: (body: unknown) => api.post(`${AUTO_PARTS}/vehicle-engines`, body),

  listEquivalences: (reference?: string) =>
    api.get<OemEquivalenceRow[]>(`${AUTO_PARTS}/equivalences`, { reference }),
  createEquivalence: (body: unknown) =>
    api.post<OemEquivalenceRow>(`${AUTO_PARTS}/equivalences`, body),
  deleteEquivalence: (id: string) => api.delete(`${AUTO_PARTS}/equivalences/${id}`),

  searchByOem: (reference: string) =>
    api.get<OemSearchResult>(`${AUTO_PARTS}/search`, { reference }),

  listCompatibilities: (productId: string) =>
    api.get<CompatibilityRow[]>(`${AUTO_PARTS}/products/${productId}/compatibilities`),
  createCompatibility: (body: unknown) => api.post(`${AUTO_PARTS}/compatibilities`, body),
  deleteCompatibility: (id: string) => api.delete(`${AUTO_PARTS}/compatibilities/${id}`),
};

export interface SizeGrid {
  id: string;
  name: string;
  sizes: string[];
}

export const clothingApi = {
  listSizeGrids: () => api.get<SizeGrid[]>("/api/modules/clothing/size-grids"),
  createSizeGrid: (body: unknown) => api.post<SizeGrid>("/api/modules/clothing/size-grids", body),
  updateSizeGrid: (id: string, body: unknown) =>
    api.patch<SizeGrid>(`/api/modules/clothing/size-grids/${id}`, body),
  deleteSizeGrid: (id: string) => api.delete(`/api/modules/clothing/size-grids/${id}`),
  generateVariants: (body: unknown) =>
    api.post<{ created: number }>("/api/modules/clothing/generate-variants", body),
};

export interface ProductLotRow {
  id: string;
  productId: string;
  warehouseId: string | null;
  lotNumber: string;
  expiryDate: string | null;
  receivedQuantity: string;
  supplierRef: string;
}

export const marketApi = {
  listLots: (filters: { search?: string; limit?: number; offset?: number } = {}) =>
    api.get<Paginated<ProductLotRow>>("/api/modules/market/lots", filters),
  createLot: (body: unknown) => api.post<ProductLotRow>("/api/modules/market/lots", body),
  updateLot: (id: string, body: unknown) =>
    api.patch<ProductLotRow>(`/api/modules/market/lots/${id}`, body),
  listExpiring: (withinDays = 30) =>
    api.get<{ lot: ProductLotRow; productName: string; productSku: string }[]>(
      "/api/modules/market/expiring",
      { withinDays }
    ),
};
