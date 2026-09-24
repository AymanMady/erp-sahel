/**
 * Lectures de repli **hors ligne** à partir de l'instantané local.
 *
 * Chaque fonction reproduit la forme de réponse de l'endpoint serveur correspondant,
 * pour que les écrans de liste restent utilisables quand le serveur est injoignable
 * ([FR-SYNC-1]). Seules les données présentes dans l'instantané sont couvertes ; les
 * documents (factures, commandes…) relèvent du cache HTTP (`http-cache.ts`).
 */

import type { Party, Product, Service } from "@shared/schema";
import { ApiError } from "@/shared/api/api-error";
import { readSnapshot, stockQuantityOf, type OfflineSnapshot } from "./snapshot";

/**
 * Exécute la requête serveur ; si le réseau est coupé, relit l'instantané local.
 * Toute autre erreur (droits, validation) est propagée telle quelle.
 */
export async function withOfflineFallback<T>(
  request: () => Promise<T>,
  fallback: (snapshot: OfflineSnapshot) => T | Promise<T>
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof ApiError) || !error.isNetworkError) throw error;
    const snapshot = await readSnapshot();
    if (!snapshot) throw error;
    return await fallback(snapshot);
  }
}

function includesTerm(term: string, ...values: (string | null | undefined)[]): boolean {
  return values.some((value) => (value ?? "").toLowerCase().includes(term));
}

function paginate<T>(rows: T[], limit = 25, offset = 0) {
  return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

export function listPartiesOffline(
  snapshot: OfflineSnapshot,
  pending: Party[],
  filters: {
    search?: string;
    partyType?: string | null;
    role?: "CUSTOMER" | "SUPPLIER" | null;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {}
) {
  const term = filters.search?.trim().toLowerCase() ?? "";
  // Les tiers créés hors ligne s'affichent en tête, pour être aussitôt utilisables.
  const rows = [...pending, ...snapshot.parties]
    .filter((party: Party) => {
      if (!filters.includeArchived && !party.isActive) return false;
      if (filters.partyType && party.partyType !== filters.partyType) return false;
      if (filters.role && party.partyType !== filters.role && party.partyType !== "BOTH") {
        return false;
      }
      return !term || includesTerm(term, party.name, party.code, party.phone, party.email);
    })
    .sort(
      (a, b) =>
        Number(pending.includes(b)) - Number(pending.includes(a)) || a.name.localeCompare(b.name)
    );
  return paginate(rows, filters.limit, filters.offset);
}

export function listServicesOffline(
  snapshot: OfflineSnapshot,
  filters: { search?: string; limit?: number; offset?: number } = {}
) {
  const term = filters.search?.trim().toLowerCase() ?? "";
  const rows = snapshot.services
    .filter(
      (service: Service) =>
        service.isActive && (!term || includesTerm(term, service.name, service.code))
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return paginate(rows, filters.limit, filters.offset);
}

/**
 * Soldes de stock hors ligne. L'instantané ne porte que produit × magasin × quantité :
 * les colonnes absentes (lot, coût moyen…) prennent leur valeur par défaut.
 */
export function listStockOffline(
  snapshot: OfflineSnapshot,
  filters: {
    warehouseId?: string | null;
    productId?: string | null;
    search?: string;
    lowStockOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
) {
  const term = filters.search?.trim().toLowerCase() ?? "";
  const productById = new Map(snapshot.products.map((row) => [row.id, row]));
  const warehouseById = new Map(snapshot.warehouses.map((row) => [row.id, row]));

  const rows = snapshot.stock
    .flatMap((row) => {
      const product = productById.get(row.productId);
      if (!product) return [];
      if (filters.warehouseId && row.warehouseId !== filters.warehouseId) return [];
      if (filters.productId && row.productId !== filters.productId) return [];
      if (term && !includesTerm(term, product.name, product.sku, product.barcode)) return [];
      if (
        filters.lowStockOnly &&
        Number.parseFloat(row.quantity || "0") > Number.parseFloat(product.minStock || "0")
      ) {
        return [];
      }
      const warehouse = warehouseById.get(row.warehouseId);
      return [
        {
          id: `${row.productId}:${row.warehouseId}`,
          companyId: product.companyId,
          productId: row.productId,
          variantId: null,
          warehouseId: row.warehouseId,
          locationId: null,
          lotNumber: "",
          quantity: row.quantity,
          reservedQuantity: "0",
          averageCostCents: 0,
          isActive: true,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          productSku: product.sku,
          productName: product.name,
          productUnit: product.unit,
          warehouseName: warehouse?.name ?? "",
          minStock: product.minStock,
        },
      ];
    })
    .sort((a, b) => a.productName.localeCompare(b.productName));

  const { items, total } = paginate(rows, filters.limit ?? 50, filters.offset);
  return { items, total };
}

/** Articles sous le seuil minimal, tous magasins confondus. */
export function lowStockOffline(snapshot: OfflineSnapshot) {
  const totals = new Map<string, number>();
  for (const row of snapshot.stock) {
    totals.set(
      row.productId,
      (totals.get(row.productId) ?? 0) + Number.parseFloat(row.quantity || "0")
    );
  }
  return snapshot.products
    .filter((product) => product.isActive && !product.isService)
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      minStock: product.minStock,
      quantity: String(totals.get(product.id) ?? 0),
    }))
    .filter((row) => Number.parseFloat(row.quantity) <= Number.parseFloat(row.minStock || "0"));
}

/**
 * Fiche produit hors ligne : produit, variantes et stock de l'instantané. Les
 * fournisseurs référencés n'y figurent pas.
 */
export function productDetailOffline(snapshot: OfflineSnapshot, id: string, pending: Product[]) {
  const product =
    pending.find((row) => row.id === id) ?? snapshot.products.find((row) => row.id === id);
  if (!product) return null;
  return {
    ...product,
    variants: snapshot.variants
      .filter((row) => row.productId === id)
      .map((row) => ({
        ...row,
        companyId: product.companyId,
        isDefault: false,
        isActive: true,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      })),
    suppliers: [],
    stockQuantity: stockQuantityOf(snapshot, id),
  };
}

/** Fiche tiers hors ligne : sans contacts ni historique (absents de l'instantané). */
export function partyDetailOffline(snapshot: OfflineSnapshot, id: string, pending: Party[]) {
  const party =
    pending.find((row) => row.id === id) ?? snapshot.parties.find((row) => row.id === id);
  if (!party) return null;
  return {
    ...party,
    contacts: [],
    addresses: [],
    history: { invoices: [], payments: [] },
    outstandingCents: 0,
  };
}
