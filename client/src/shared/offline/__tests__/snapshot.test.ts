/**
 * Recherche hors-ligne sur l'instantané local.
 *
 * L'enjeu : au comptoir sans réseau, la recherche par OEM doit donner **le même
 * résultat** qu'en ligne, équivalences transitives comprises ([FR-SRCH-2], [FR-SYNC-1]).
 */

import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { normalizeOem } from "@shared/oem";
import {
  findByBarcodeOffline,
  searchPartiesOffline,
  searchProductsOffline,
  stockQuantityOf,
  type OfflineSnapshot,
} from "../snapshot";

function buildSnapshot(): OfflineSnapshot {
  const product = (id: string, sku: string, name: string, barcode = "") =>
    ({
      id,
      companyId: "c1",
      profileType: "AUTO_PARTS",
      sku,
      name,
      description: "",
      categoryId: null,
      unit: "pièce",
      barcode,
      purchasePriceCents: 0,
      salePriceCents: 10_000,
      vatRateBp: 1600,
      isService: false,
      imageUrl: null,
      imageUrls: [],
      minStock: "0",
      clientUuid: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
    }) as unknown as OfflineSnapshot["products"][number];

  return {
    generatedAt: new Date().toISOString(),
    cursor: new Date().toISOString(),
    company: null,
    categories: [],
    products: [
      product("p1", "FH-TOY-001", "Filtre à huile Toyota"),
      product("p2", "FH-DEN-001", "Filtre à huile Denso"),
      product("p3", "PLQ-001", "Plaquettes de frein", "1234567890123"),
    ],
    variants: [],
    stock: [
      { productId: "p1", warehouseId: "w1", quantity: "12" },
      { productId: "p1", warehouseId: "w2", quantity: "8" },
      { productId: "p2", warehouseId: "w1", quantity: "5" },
    ],
    parties: [
      {
        id: "party1",
        code: "CLI-0001",
        name: "Garage El Amine",
        phone: "45251010",
        isActive: true,
      },
      { id: "party2", code: "CLI-0002", name: "Atelier Nord", phone: "", isActive: true },
    ] as unknown as OfflineSnapshot["parties"],
    services: [],
    warehouses: [],
    registers: [],
    paymentAccounts: [],
    session: null,
    modules: [{ code: "auto_parts", name: "Pièces auto", version: "1.0.0" }],
    moduleData: {
      auto_parts: {
        profiles: [
          {
            productId: "p1",
            oemReference: "90915-YZZD3",
            oemNormalized: normalizeOem("90915-YZZD3"),
            manufacturerId: "m1",
            countryId: "co1",
            qualityLevelId: "q1",
            manufacturerRef: "",
            warrantyMonths: 12,
          },
          {
            productId: "p2",
            oemReference: "90915-YZZE1",
            oemNormalized: normalizeOem("90915-YZZE1"),
            manufacturerId: "m2",
            countryId: "co2",
            qualityLevelId: "q2",
            manufacturerRef: "",
            warrantyMonths: 6,
          },
        ],
        equivalences: [
          { normA: normalizeOem("90915-10004"), normB: normalizeOem("90915-YZZD3") },
          { normA: normalizeOem("90915-YZZD3"), normB: normalizeOem("90915-YZZE1") },
        ],
        compatibilities: [],
        countries: [
          { id: "co1", code: "JP", name: "Japon" },
          { id: "co2", code: "TH", name: "Thaïlande" },
        ],
        qualityLevels: [
          { id: "q1", code: "OEM", label: "Original (OEM)", rank: 1 },
          { id: "q2", code: "PREMIUM", label: "Premium", rank: 3 },
        ],
        manufacturers: [
          { id: "m1", name: "Toyota Genuine" },
          { id: "m2", name: "Denso" },
        ],
        vehicles: { brands: [], models: [], generations: [], engines: [] },
      },
    },
    syncEntities: [],
  };
}

describe("recherche produit hors ligne", () => {
  const snapshot = buildSnapshot();

  it("trouve par désignation", () => {
    const results = searchProductsOffline(snapshot, "plaquettes");
    expect(results.map((product) => product.id)).toEqual(["p3"]);
  });

  it("trouve par référence interne", () => {
    expect(searchProductsOffline(snapshot, "FH-TOY")).toHaveLength(1);
  });

  /** Le cas décisif : une référence non portée par aucun produit, mais équivalente. */
  it("retrouve les articles via la fermeture transitive des équivalences", () => {
    const results = searchProductsOffline(snapshot, "90915-10004");
    expect(results.map((product) => product.id).sort()).toEqual(["p1", "p2"]);
  });

  it("enrichit les résultats avec fabricant, origine et qualité", () => {
    const [first] = searchProductsOffline(snapshot, "FH-TOY");
    expect(first.manufacturerName).toBe("Toyota Genuine");
    expect(first.countryName).toBe("Japon");
    expect(first.qualityLabel).toBe("Original (OEM)");
  });

  it("agrège le stock de tous les magasins", () => {
    expect(stockQuantityOf(snapshot, "p1")).toBe(20);
    expect(stockQuantityOf(snapshot, "p3")).toBe(0);
  });

  it("résout un code-barres scanné", () => {
    expect(findByBarcodeOffline(snapshot, "1234567890123")?.id).toBe("p3");
    expect(findByBarcodeOffline(snapshot, "0000")).toBeNull();
  });
});

describe("recherche de tiers hors ligne", () => {
  const snapshot = buildSnapshot();

  it("cherche par nom, code ou téléphone", () => {
    expect(searchPartiesOffline(snapshot, "amine")).toHaveLength(1);
    expect(searchPartiesOffline(snapshot, "CLI-0002")).toHaveLength(1);
    expect(searchPartiesOffline(snapshot, "45251010")).toHaveLength(1);
  });

  it("renvoie tous les tiers actifs sans terme de recherche", () => {
    expect(searchPartiesOffline(snapshot, "")).toHaveLength(2);
  });
});
