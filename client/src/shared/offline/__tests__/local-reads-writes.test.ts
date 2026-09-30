/**
 * Screens of the offline-first desktop read and write the local database through the
 * same entity APIs as online (`entities/*\/api.ts`): same answers as the server, no
 * network, and each change queued with the row in one write.
 */

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncTable } from "@shared/sync-protocol";
import { bankingApi } from "@/entities/banking/api";
import { catalogApi } from "@/entities/catalog/api";
import { inventoryApi } from "@/entities/inventory/api";
import { partyApi } from "@/entities/party/api";
import { ApiError } from "@/shared/api/api-error";
import { offlineDb } from "../db";
import { runSync } from "../sync-engine";
import { startLocalSession, stopLocalSession } from "../local/local-sync";
import { refreshReadiness } from "../local/replication";
import { FakeLocalDb } from "./fake-local-db";

const COMPANY = "11111111-1111-4111-8111-111111111111";

let fake: FakeLocalDb;
let fetchCalls: { method: string; url: string; body: unknown }[] = [];
let pushResults: (operations: Record<string, unknown>[]) => unknown[] = () => [];

type Row = Record<string, unknown>;

function seed(entity: SyncTable, rows: Row[], version = 1) {
  for (const data of rows) {
    fake.table(entity).set(String(data.id), {
      id: String(data.id),
      version,
      pending: false,
      deletedAt: null,
      data: { companyId: COMPANY, isActive: true, ...data },
    });
  }
}

async function ready(...entities: SyncTable[]) {
  fake.meta.set("bootstrap_completed_at", "2026-09-30T00:00:00.000Z");
  for (const entity of entities) {
    fake.progress.set(entity, { entity, afterId: null, rows: 0, total: null, done: true });
  }
  await refreshReadiness();
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  fake = new FakeLocalDb();
  fetchCalls = [];
  const memory = new Map<string, string>();
  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {
      invoke: (command: string, args?: Record<string, unknown>) => fake.invoke(command, args),
    },
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "http://server.test");
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      fetchCalls.push({ method: init.method ?? "GET", url: url.pathname + url.search, body });
      if (url.pathname === "/api/sync/push") {
        return json({ results: pushResults((body as { operations: Row[] }).operations) });
      }
      if (url.pathname === "/api/sync/pull" && url.searchParams.has("cursor")) {
        return json({
          cursor: 1,
          hasMore: false,
          resync: false,
          scope: [...fake.progress.keys()],
          changes: [],
        });
      }
      if (url.pathname === "/api/sync/snapshot")
        return json({ cursor: "", products: [], modules: [] });
      return json({ items: [], total: 0 });
    })
  );
  await offlineDb.open();
  await offlineDb.outbox.clear();
  await offlineDb.cache.clear();
  await startLocalSession(COMPANY);

  seed("categories", [
    { id: "c1", name: "Grains" },
    { id: "c2", name: "Old", isActive: false },
  ]);
  seed("products", [
    {
      id: "p1",
      name: "Riz",
      sku: "RIZ",
      barcode: "6001",
      description: "",
      categoryId: "c1",
      salePriceCents: 2000,
      isService: false,
      minStock: "10.000",
      createdAt: "2026-01-01",
      variants: [
        { id: "v2", sku: "M", barcode: "7002", isActive: true },
        { id: "v1", sku: "L", barcode: "7001", isActive: true },
        { id: "v3", sku: "X", barcode: "7003", isActive: false },
      ],
      suppliers: [{ id: "l1", supplierId: "s1", isActive: true }],
    },
    {
      id: "p2",
      name: "Sucre 6001 g",
      sku: "SUC",
      barcode: "60011",
      description: "",
      categoryId: "c2",
      salePriceCents: 500,
      isService: false,
      minStock: "0",
      createdAt: "2026-02-01",
    },
    {
      id: "p3",
      name: "Huile",
      sku: "HUI",
      barcode: "",
      description: "Tournesol 6001",
      categoryId: null,
      salePriceCents: 1500,
      isService: false,
      minStock: "0",
      createdAt: "2026-03-01",
      isActive: false,
    },
  ]);
  seed("stock_items", [
    { id: "s-a", productId: "p1", warehouseId: "w1", quantity: "4.000" },
    { id: "s-b", productId: "p1", warehouseId: "w2", quantity: "2.500" },
  ]);
  seed("warehouses", [
    { id: "w1", name: "Boutique" },
    { id: "w2", name: "Dépôt" },
  ]);
  seed("parties", [
    {
      id: "s1",
      name: "Fournisseur Nour",
      code: "FRN-1",
      partyType: "SUPPLIER",
      createdAt: "2026-01-01",
    },
    {
      id: "cu1",
      name: "Aminata",
      code: "CLI-1",
      partyType: "CUSTOMER",
      createdAt: "2026-02-01",
      contacts: [],
      addresses: [],
    },
    { id: "cu2", name: "Bocar", code: "CLI-2", partyType: "BOTH", createdAt: "2026-03-01" },
    { id: "pr1", name: "Prospect", code: "PRO-1", partyType: "PROSPECT", createdAt: "2026-04-01" },
  ]);
  seed("sales_invoices", [
    {
      id: "i1",
      partyId: "cu1",
      number: "FAC-1",
      date: "2026-05-01",
      status: "PARTIALLY_PAID",
      totalCents: 10000,
      paidAmountCents: 4000,
      creditedAmountCents: 1000,
    },
    {
      id: "i2",
      partyId: "cu1",
      number: "FAC-2",
      date: "2026-06-01",
      status: "PAID",
      totalCents: 3000,
      paidAmountCents: 3000,
      creditedAmountCents: 0,
    },
  ]);
  seed("payments", [
    {
      id: "pay1",
      partyId: "cu1",
      number: "REG-1",
      paymentDate: "2026-05-02",
      amountCents: 4000,
      paymentMethod: "CASH",
      direction: "IN",
      invoiceId: "i1",
    },
  ]);
  seed("bank_accounts", [
    { id: "b1", code: "CAISSE", name: "Caisse", accountType: "CASH", isDefault: true },
    {
      id: "b2",
      code: "OLD",
      name: "Ancien",
      accountType: "BANK",
      isDefault: false,
      isActive: false,
    },
  ]);
  await ready(
    "categories",
    "products",
    "stock_items",
    "warehouses",
    "parties",
    "sales_invoices",
    "payments",
    "bank_accounts"
  );
});

afterEach(async () => {
  await stopLocalSession();
  vi.unstubAllGlobals();
});

const serverCalls = () => fetchCalls.filter((call) => !call.url.startsWith("/api/health"));

describe("reads from the local database", () => {
  it("list products like the server: contained SKU, name, description, or the whole barcode", async () => {
    const result = await catalogApi.listProducts({ search: "6001" });
    // p1 by its whole barcode, p2 by its name; p3 archived; "60011" is not "6001".
    expect(result.items.map((item) => item.id)).toEqual(["p1", "p2"]);
    expect(result.total).toBe(2);
    expect(serverCalls()).toEqual([]);
  });

  it("name the category, add the stock of every warehouse, sort and page", async () => {
    const result = await catalogApi.listProducts({
      withStock: true,
      orderBy: "price",
      includeArchived: true,
      limit: 2,
    });
    expect(result.items.map((item) => item.id)).toEqual(["p2", "p3"]);
    expect(result.total).toBe(3);
    expect(result.items[0].categoryName).toBe("Old");
    const all = await catalogApi.listProducts({ withStock: true });
    expect(all.items.find((item) => item.id === "p1")?.stockQuantity).toBe(6.5);
    expect(all.items.find((item) => item.id === "p2")?.stockQuantity).toBe(0);
  });

  it("show a product with its active variants, its named suppliers and its stock", async () => {
    const detail = await catalogApi.getProduct("p1");
    expect(detail.variants.map((variant) => variant.sku)).toEqual(["L", "M"]);
    expect(detail.suppliers).toEqual([
      expect.objectContaining({ supplierName: "Fournisseur Nour", supplierCode: "FRN-1" }),
    ]);
    expect(detail.stockQuantity).toBe(6.5);
  });

  it("find a product by its barcode or an active variant's, and refuse the others", async () => {
    expect((await catalogApi.findByBarcode("6001")).id).toBe("p1");
    expect((await catalogApi.findByBarcode(" 7002 ")).id).toBe("p1");
    await expect(catalogApi.findByBarcode("7003")).rejects.toBeInstanceOf(ApiError);
    await expect(catalogApi.findByBarcode("0000")).rejects.toMatchObject({ status: 404 });
  });

  it("list parties by role like the server: the role or both, by name, never prospects", async () => {
    const customers = await partyApi.list({ role: "CUSTOMER" });
    expect(customers.items.map((party) => party.id)).toEqual(["cu1", "cu2"]);
    expect(customers.total).toBe(2);
    const everyone = await partyApi.list({});
    // Newest first, as online.
    expect(everyone.items.map((party) => party.id)).toEqual(["pr1", "cu2", "cu1", "s1"]);
  });

  it("show what a customer still owes, with their invoices and payments", async () => {
    const detail = await partyApi.get("cu1");
    expect(detail.outstandingCents).toBe(5000);
    expect(detail.history.invoices.map((invoice) => invoice.number)).toEqual(["FAC-2", "FAC-1"]);
    expect(detail.history.payments.map((payment) => payment.number)).toEqual(["REG-1"]);
  });

  it("list stock lines with their product and warehouse, and the low ones", async () => {
    const stock = await inventoryApi.listStock({ lowStockOnly: true });
    expect(
      stock.items.map((line) => [line.productName, line.warehouseName, line.minStock])
    ).toEqual([
      ["Riz", "Boutique", "10.000"],
      ["Riz", "Dépôt", "10.000"],
    ]);
    expect(await inventoryApi.lowStock()).toEqual([
      { productId: "p1", sku: "RIZ", name: "Riz", minStock: "10.000", quantity: "6.5" },
    ]);
  });

  it("list payment accounts without bank details", async () => {
    expect(await bankingApi.listPaymentAccounts()).toEqual([
      { id: "b1", code: "CAISSE", name: "Caisse", accountType: "CASH", isDefault: true },
    ]);
  });

  it("keep using the server while an entity is not downloaded", async () => {
    fake.progress.set("services", {
      entity: "services",
      afterId: "x",
      rows: 3,
      total: 10,
      done: false,
    });
    fake.progress.set("parties", {
      entity: "parties",
      afterId: null,
      rows: 0,
      total: null,
      done: false,
    });
    await refreshReadiness();
    await partyApi.list({});
    expect(serverCalls().map((call) => call.url)).toContain("/api/parties");
  });
});

describe("writes to the local database", () => {
  it("create a product here and queue its creation with the same id", async () => {
    const created = await catalogApi.createProduct({
      name: "Lait",
      salePriceCents: 800,
      imageUrls: ["a.png"],
      initialStock: null,
    });
    const row = fake.table("products").get(created.id)!;
    expect(row).toMatchObject({ pending: true, version: 0 });
    expect(row.data).toMatchObject({ name: "Lait", isActive: true, companyId: COMPANY });
    const [operation] = [...fake.queue.values()];
    expect(operation).toMatchObject({
      id: created.id,
      entityId: created.id,
      operation: "CREATE",
      entity: "catalog.product",
    });
    expect(operation.payload).toMatchObject({
      name: "Lait",
      salePriceCents: 800,
      imageUrls: ["a.png"],
    });
    expect(serverCalls()).toEqual([]);
    // Shown at once in the local list.
    expect(
      (await catalogApi.listProducts({ search: "Lait" })).items.map((item) => item.id)
    ).toEqual([created.id]);
  });

  it("queue only the fields that changed, with their former value and the row version", async () => {
    await catalogApi.updateProduct("p1", { name: "Riz", salePriceCents: 2200, description: "" });
    const [operation] = [...fake.queue.values()];
    expect(operation).toMatchObject({
      operation: "UPDATE",
      entityId: "p1",
      baseVersion: 1,
      dependsOn: [],
    });
    expect(operation.payload).toEqual({
      changes: { salePriceCents: 2200 },
      base: { salePriceCents: 2000 },
    });
    expect(fake.table("products").get("p1")!.data.salePriceCents).toBe(2200);
  });

  it("queue nothing when nothing changed", async () => {
    await catalogApi.updateProduct("p1", { name: "Riz", salePriceCents: 2000 });
    expect(fake.queue.size).toBe(0);
  });

  it("make a change of a row created here wait for its creation", async () => {
    const created = await partyApi.create({ name: "Nouveau client", partyType: "CUSTOMER" });
    await partyApi.update(created.id, { phone: "22 22 22 22" });
    const update = [...fake.queue.values()].find((row) => row.operation === "UPDATE")!;
    expect(update.dependsOn).toEqual([created.id]);
    expect(update.baseVersion).toBe(0);
  });

  it("archive here with a tombstone until the server confirms", async () => {
    await catalogApi.archiveProduct("p2");
    const row = fake.table("products").get("p2")!;
    expect(row.deletedAt).toBeTruthy();
    expect(row.data.isActive).toBe(false);
    expect([...fake.queue.values()][0]).toMatchObject({ operation: "DELETE", entityId: "p2" });
    expect(
      (await catalogApi.listProducts({ includeArchived: true })).items.map((item) => item.id)
    ).not.toContain("p2");
  });

  it("send the change as the server expects it when the network is there", async () => {
    await catalogApi.updateProduct("p1", { salePriceCents: 2500 });
    pushResults = (operations) =>
      operations.map((operation) => ({
        clientUuid: operation.clientUuid,
        entity: operation.entity,
        status: "created",
        outcome: "success",
        record: {
          entity: "products",
          id: "p1",
          version: 2,
          data: { ...fake.table("products").get("p1")!.data, salePriceCents: 2500 },
        },
      }));
    await runSync({ force: true });
    const push = fetchCalls.find((call) => call.url === "/api/sync/push")!;
    expect((push.body as { operations: Row[] }).operations[0]).toMatchObject({
      entity: "catalog.product",
      action: "update",
      entityId: "p1",
      baseVersion: 1,
      payload: { changes: { salePriceCents: 2500 }, base: { salePriceCents: 2000 } },
    });
    expect(fake.table("products").get("p1")).toMatchObject({ pending: false, version: 2 });
  });
});
