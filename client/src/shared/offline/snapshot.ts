/**
 * Instantané hors-ligne : téléchargement, stockage et lecture.
 *
 * C'est la moitié « lecture » du mode hors ligne (l'outbox étant la moitié « écriture ») :
 * sans lui, un poste déconnecté ne pourrait plus chercher un produit ni un client.
 */

import type {
  Product,
  Party,
  Category,
  Service,
  Warehouse,
  PosRegister,
  PosSession,
} from "@shared/schema";
import { api } from "@/shared/api/http";
import { devicePlatform } from "@/shared/desktop/desktop";
import { readSnapshotCache, writeSnapshotCache } from "./storage";

const SNAPSHOT_KEY = "sync.snapshot";

export interface SnapshotStock {
  productId: string;
  warehouseId: string;
  quantity: string;
}

export interface OfflineSnapshot {
  generatedAt: string;
  cursor: string;
  company: {
    id: string;
    name: string;
    legalName: string;
    currency: string;
    language: string;
    vatEnabled: boolean;
    defaultVatRateBp: number;
    logo: string | null;
    address: string;
    phone: string;
    email: string;
    taxId: string;
  } | null;
  categories: Category[];
  products: Product[];
  variants: {
    id: string;
    productId: string;
    sku: string;
    barcode: string;
    attributes: Record<string, string>;
    salePriceCents: number | null;
  }[];
  stock: SnapshotStock[];
  parties: Party[];
  services: Service[];
  warehouses: Warehouse[];
  registers: PosRegister[];
  paymentAccounts: {
    id: string;
    code: string;
    name: string;
    accountType: string;
    currency: string;
    isDefault: boolean;
  }[];
  session: PosSession | null;
  modules: { code: string; name: string }[];
  syncEntities: string[];
}

/** Télécharge un instantané frais et le persiste. */
export async function pullSnapshot(): Promise<OfflineSnapshot> {
  const snapshot = await api.get<OfflineSnapshot>("/api/sync/snapshot", {
    platform: devicePlatform(),
  });
  await writeSnapshotCache(SNAPSHOT_KEY, snapshot);
  return snapshot;
}

export async function readSnapshot(): Promise<OfflineSnapshot | null> {
  return readSnapshotCache<OfflineSnapshot>(SNAPSHOT_KEY);
}

/** Réécrit l'instantané local — reflet des écritures faites hors ligne. */
export async function writeSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  await writeSnapshotCache(SNAPSHOT_KEY, snapshot);
}

/** Applique un delta de `pull` sur l'instantané en cache, sans tout retélécharger. */
export async function applyDelta(delta: {
  cursor: string;
  products?: Product[];
  parties?: Party[];
  services?: Service[];
  stock?: SnapshotStock[];
}): Promise<void> {
  const snapshot = await readSnapshot();
  if (!snapshot) return;

  const merge = <T extends { id: string }>(current: T[], incoming: T[] | undefined): T[] => {
    if (!incoming || incoming.length === 0) return current;
    const byId = new Map(current.map((row) => [row.id, row]));
    for (const row of incoming) byId.set(row.id, row);
    return [...byId.values()];
  };

  const mergedStock = (() => {
    if (!delta.stock || delta.stock.length === 0) return snapshot.stock;
    const key = (row: SnapshotStock) => `${row.productId}:${row.warehouseId}`;
    const byKey = new Map(snapshot.stock.map((row) => [key(row), row]));
    for (const row of delta.stock) byKey.set(key(row), row);
    return [...byKey.values()];
  })();

  await writeSnapshotCache(SNAPSHOT_KEY, {
    ...snapshot,
    cursor: delta.cursor,
    products: merge(snapshot.products, delta.products),
    parties: merge(snapshot.parties, delta.parties),
    services: merge(snapshot.services, delta.services),
    stock: mergedStock,
  } satisfies OfflineSnapshot);
}

/** Solde de stock local, tous magasins confondus. */
export function stockQuantityOf(snapshot: OfflineSnapshot, productId: string): number {
  return snapshot.stock
    .filter((row) => row.productId === productId)
    .reduce((sum, row) => sum + Number.parseFloat(row.quantity || "0"), 0);
}

export interface OfflineProductResult extends Product {
  stockQuantity: number;
}

/**
 * Recherche produit **hors ligne** (nom, référence, code-barres) : même comportement
 * que le serveur, pour que le comptoir continue de vendre sans réseau ([FR-SRCH-2]).
 */
export function searchProductsOffline(
  snapshot: OfflineSnapshot,
  query: string,
  limit = 50
): OfflineProductResult[] {
  const term = query.trim().toLowerCase();

  const matches = snapshot.products.filter((product) => {
    if (!product.isActive) return false;
    if (!term) return true;
    if (product.name.toLowerCase().includes(term)) return true;
    if (product.sku.toLowerCase().includes(term)) return true;
    if (product.barcode && product.barcode.toLowerCase() === term) return true;
    // Une variante (taille, couleur…) peut porter son propre code-barres.
    return snapshot.variants.some(
      (variant) => variant.productId === product.id && variant.barcode.toLowerCase() === term
    );
  });

  return matches.slice(0, limit).map((product) => ({
    ...product,
    stockQuantity: stockQuantityOf(snapshot, product.id),
  }));
}

/** Recherche de tiers hors ligne (nom, code, téléphone). */
export function searchPartiesOffline(
  snapshot: OfflineSnapshot,
  query: string,
  limit = 30
): Party[] {
  const term = query.trim().toLowerCase();
  return snapshot.parties
    .filter((party) => {
      if (!party.isActive) return false;
      if (!term) return true;
      return (
        party.name.toLowerCase().includes(term) ||
        party.code.toLowerCase().includes(term) ||
        party.phone.toLowerCase().includes(term)
      );
    })
    .slice(0, limit);
}

/** Produit correspondant à un code-barres scanné (produit ou variante). */
export function findByBarcodeOffline(snapshot: OfflineSnapshot, barcode: string): Product | null {
  const value = barcode.trim();
  if (!value) return null;
  const direct = snapshot.products.find((product) => product.barcode === value);
  if (direct) return direct;
  const variant = snapshot.variants.find((row) => row.barcode === value);
  if (!variant) return null;
  return snapshot.products.find((product) => product.id === variant.productId) ?? null;
}

export interface OfflineProductFilters {
  search?: string;
  categoryId?: string | null;
  isService?: boolean | null;
  includeArchived?: boolean;
  orderBy?: "name" | "sku" | "price" | "recent";
  limit?: number;
  offset?: number;
}

/**
 * Liste paginée du catalogue **hors ligne** : même forme que `GET /api/catalog/products`,
 * pour que les écrans de liste restent utilisables quand le serveur est injoignable.
 */
export function listProductsOffline(
  snapshot: OfflineSnapshot,
  filters: OfflineProductFilters = {},
  /** Produits créés hors ligne, affichés en tête de liste. */
  pending: Product[] = []
): {
  items: (Product & { categoryName: string | null; stockQuantity: number })[];
  total: number;
  limit: number;
  offset: number;
} {
  const limit = filters.limit ?? 25;
  const offset = filters.offset ?? 0;
  const term = filters.search?.trim().toLowerCase() ?? "";
  const categoryById = new Map(snapshot.categories.map((row) => [row.id, row.name]));

  const matches = [...pending, ...snapshot.products].filter((product) => {
    if (!filters.includeArchived && !product.isActive) return false;
    if (filters.categoryId && product.categoryId !== filters.categoryId) return false;
    if (typeof filters.isService === "boolean" && product.isService !== filters.isService) {
      return false;
    }
    if (!term) return true;
    return (
      product.name.toLowerCase().includes(term) ||
      product.sku.toLowerCase().includes(term) ||
      (product.barcode ?? "").toLowerCase().includes(term)
    );
  });

  const sorted = [...matches].sort((a, b) => {
    const pendingOrder = Number(pending.includes(b)) - Number(pending.includes(a));
    if (pendingOrder !== 0) return pendingOrder;
    switch (filters.orderBy) {
      case "sku":
        return a.sku.localeCompare(b.sku);
      case "price":
        return a.salePriceCents - b.salePriceCents;
      case "recent":
        return String(b.createdAt).localeCompare(String(a.createdAt));
      default:
        return a.name.localeCompare(b.name);
    }
  });

  return {
    items: sorted.slice(offset, offset + limit).map((product) => ({
      ...product,
      categoryName: product.categoryId ? (categoryById.get(product.categoryId) ?? null) : null,
      stockQuantity: stockQuantityOf(snapshot, product.id),
    })),
    total: sorted.length,
    limit,
    offset,
  };
}
