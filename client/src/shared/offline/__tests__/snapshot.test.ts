/**
 * Offline search on the local snapshot.
 *
 * What is at stake: at the counter without network, search must give **the same
 * result** as online ([FR-SRCH-2], [FR-SYNC-1]).
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
      unit: "piece",
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
      product("p1", "FH-TOY-001", "Toyota oil filter"),
      product("p2", "FH-DEN-001", "Denso oil filter"),
      product("p3", "PLQ-001", "Brake pads", "1234567890123"),
    ],
    variants: [
      {
        id: "v1",
        productId: "p2",
        sku: "FH-DEN-001-XL",
        barcode: "9990001112223",
        attributes: { size: "XL" },
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
      { id: "party2", code: "CLI-0002", name: "North Workshop", phone: "", isActive: true },
    ] as unknown as OfflineSnapshot["parties"],
    services: [],
    warehouses: [],
    registers: [],
    paymentAccounts: [],
    session: null,
    modules: [{ code: "pos", name: "Point of sale" }],
    syncEntities: [],
  };
}

describe("offline product search", () => {
  const snapshot = buildSnapshot();

  it("finds by name", () => {
    const results = searchProductsOffline(snapshot, "brake");
    expect(results.map((product) => product.id)).toEqual(["p3"]);
  });

  it("finds by internal SKU", () => {
    expect(searchProductsOffline(snapshot, "FH-TOY")).toHaveLength(1);
  });

  it("finds by a variant barcode", () => {
    const results = searchProductsOffline(snapshot, "9990001112223");
    expect(results.map((product) => product.id)).toEqual(["p2"]);
  });

  it("aggregates stock across all warehouses", () => {
    expect(stockQuantityOf(snapshot, "p1")).toBe(20);
    expect(stockQuantityOf(snapshot, "p3")).toBe(0);
  });

  it("resolves a scanned barcode", () => {
    expect(findByBarcodeOffline(snapshot, "1234567890123")?.id).toBe("p3");
    expect(findByBarcodeOffline(snapshot, "9990001112223")?.id).toBe("p2");
    expect(findByBarcodeOffline(snapshot, "0000")).toBeNull();
  });
});

describe("offline party search", () => {
  const snapshot = buildSnapshot();

  it("searches by name, code or phone", () => {
    expect(searchPartiesOffline(snapshot, "amine")).toHaveLength(1);
    expect(searchPartiesOffline(snapshot, "CLI-0002")).toHaveLength(1);
    expect(searchPartiesOffline(snapshot, "45251010")).toHaveLength(1);
  });

  it("returns all active parties without a search term", () => {
    expect(searchPartiesOffline(snapshot, "")).toHaveLength(2);
  });
});
