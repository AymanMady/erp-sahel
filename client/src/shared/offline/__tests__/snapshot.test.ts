/**
 * Recherche hors-ligne sur l'instantané local.
 *
 * L'enjeu : au comptoir sans réseau, la recherche doit donner **le même résultat**
 * qu'en ligne ([FR-SRCH-2], [FR-SYNC-1]).
 */

import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

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
      profileType: "GENERIC",
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
    variants: [
      {
        id: "v1",
        productId: "p2",
        sku: "FH-DEN-001-XL",
        barcode: "9990001112223",
        attributes: { taille: "XL" },
        salePriceCents: null,
      },
    ],
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
    modules: [{ code: "pos", name: "Caisse" }],
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

  it("trouve par code-barres d'une variante", () => {
    const results = searchProductsOffline(snapshot, "9990001112223");
    expect(results.map((product) => product.id)).toEqual(["p2"]);
  });

  it("agrège le stock de tous les magasins", () => {
    expect(stockQuantityOf(snapshot, "p1")).toBe(20);
    expect(stockQuantityOf(snapshot, "p3")).toBe(0);
  });

  it("résout un code-barres scanné", () => {
    expect(findByBarcodeOffline(snapshot, "1234567890123")?.id).toBe("p3");
    expect(findByBarcodeOffline(snapshot, "9990001112223")?.id).toBe("p2");
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
