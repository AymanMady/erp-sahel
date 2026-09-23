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
import { normalizeOem, resolveEquivalents } from "@shared/oem";
import { api } from "@/shared/api/http";
import { devicePlatform } from "@/shared/desktop/desktop";
import { readSnapshotCache, writeSnapshotCache } from "./storage";

const SNAPSHOT_KEY = "sync.snapshot";

export interface SnapshotStock {
  productId: string;
  warehouseId: string;
  quantity: string;
}

export interface AutoPartsSnapshot {
  profiles: {
    productId: string;
    oemReference: string;
    oemNormalized: string;
    manufacturerId: string | null;
    countryId: string | null;
    qualityLevelId: string | null;
    manufacturerRef: string;
    warrantyMonths: number;
  }[];
  equivalences: { normA: string; normB: string }[];
  compatibilities: {
    productId: string;
    modelId: string;
    generationId: string | null;
    engineId: string | null;
  }[];
  countries: { id: string; code: string; name: string }[];
  qualityLevels: { id: string; code: string; label: string; rank: number }[];
  manufacturers: { id: string; name: string }[];
  vehicles: {
    brands: { id: string; name: string }[];
    models: { id: string; brandId: string; name: string }[];
    generations: {
      id: string;
      modelId: string;
      name: string;
      yearStart: number;
      yearEnd: number | null;
    }[];
    engines: { id: string; generationId: string; code: string; label: string }[];
  };
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
  modules: { code: string; name: string; version: string }[];
  moduleData: { auto_parts?: AutoPartsSnapshot; [key: string]: unknown };
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
  /** Profil Auto Parts, quand le module est actif. */
  oemReference?: string;
  manufacturerName?: string;
  countryName?: string;
  qualityLabel?: string;
}

/**
 * Recherche produit **hors ligne**.
 *
 * Reproduit le comportement du serveur, y compris la recherche par OEM avec
 * **fermeture transitive des équivalences** : c'est le cœur de la valeur métier du
 * comptoir, il ne doit pas disparaître avec le réseau ([FR-SRCH-2], [FR-SRCH-3]).
 */
export function searchProductsOffline(
  snapshot: OfflineSnapshot,
  query: string,
  limit = 50
): OfflineProductResult[] {
  const term = query.trim().toLowerCase();
  const autoParts = snapshot.moduleData?.auto_parts;

  const profileByProduct = new Map(
    (autoParts?.profiles ?? []).map((profile) => [profile.productId, profile])
  );
  const manufacturerById = new Map(
    (autoParts?.manufacturers ?? []).map((row) => [row.id, row.name])
  );
  const countryById = new Map((autoParts?.countries ?? []).map((row) => [row.id, row.name]));
  const qualityById = new Map((autoParts?.qualityLevels ?? []).map((row) => [row.id, row.label]));

  // Classe d'équivalence de la saisie, pour retrouver les articles « compatibles ».
  const equivalentNorms = term
    ? new Set(resolveEquivalents(term, autoParts?.equivalences ?? []))
    : new Set<string>();
  const normalizedTerm = normalizeOem(term);

  const matches = snapshot.products.filter((product) => {
    if (!product.isActive) return false;
    if (!term) return true;
    if (product.name.toLowerCase().includes(term)) return true;
    if (product.sku.toLowerCase().includes(term)) return true;
    if (product.barcode && product.barcode.toLowerCase() === term) return true;

    const profile = profileByProduct.get(product.id);
    if (!profile) return false;
    if (profile.oemNormalized === normalizedTerm) return true;
    return equivalentNorms.has(profile.oemNormalized);
  });

  return matches.slice(0, limit).map((product) => {
    const profile = profileByProduct.get(product.id);
    return {
      ...product,
      stockQuantity: stockQuantityOf(snapshot, product.id),
      oemReference: profile?.oemReference,
      manufacturerName: profile?.manufacturerId
        ? manufacturerById.get(profile.manufacturerId)
        : undefined,
      countryName: profile?.countryId ? countryById.get(profile.countryId) : undefined,
      qualityLabel: profile?.qualityLevelId ? qualityById.get(profile.qualityLevelId) : undefined,
    };
  });
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
