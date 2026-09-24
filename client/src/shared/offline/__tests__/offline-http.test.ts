/**
 * Generic queue of offline writes: every page must be able to save without network,
 * show the entry right away, then replay it exactly once when the network returns.
 */

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/shared/api/http";
import { ApiError } from "@/shared/api/api-error";
import { i18n } from "@/shared/i18n";
import { offlineDb, HTTP_REQUEST_ENTITY } from "../db";
import { readCachedResponse, storeCachedResponse } from "../http-cache";
import { runSync } from "../sync-engine";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[] = [];
let online = false;
let routes: (call: Call) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  await offlineDb.open();
  await offlineDb.outbox.clear();
  await offlineDb.meta.clear();
  await offlineDb.cache.clear();
  calls = [];
  online = false;
  routes = () => json({});
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        url,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      if (!online) throw new TypeError("Failed to fetch");
      return routes(call);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline reads", () => {
  it("shows roles already viewed again", async () => {
    online = true;
    routes = () => json([{ id: "r1", name: "Cashier" }]);
    await api.get("/api/roles");
    await new Promise((resolve) => setTimeout(resolve, 10));

    online = false;
    expect(await api.get("/api/roles")).toEqual([{ id: "r1", name: "Cashier" }]);
  });
});

describe("offline writes", () => {
  it("queues the write with the idempotency key already sent", async () => {
    const created = (await api.post("/api/roles", { name: "Storekeeper", permissions: [] })) as {
      id: string;
      name: string;
    };

    const [record] = await offlineDb.outbox.toArray();
    expect(record.entity).toBe(HTTP_REQUEST_ENTITY);
    expect(record.payload).toMatchObject({ method: "POST", url: "/api/roles" });
    // The first attempt already carried the key: if the server received it, the
    // replay will not create anything more.
    expect(calls[0].headers["Idempotency-Key"]).toBe(record.clientUuid);
    expect(created).toMatchObject({ id: record.clientUuid, name: "Storekeeper" });
  });

  it("immediately shows the entry in the list and the detail", async () => {
    await storeCachedResponse("/api/roles", [{ id: "r1", name: "Cashier" }]);

    const created = (await api.post("/api/roles", { name: "Storekeeper" })) as { id: string };
    const roles = (await api.get("/api/roles")) as { id: string; name: string }[];
    expect(roles.map((role) => role.name)).toEqual(["Storekeeper", "Cashier"]);

    await api.patch(`/api/roles/${created.id}`, { name: "Head storekeeper" });
    const detail = (await readCachedResponse(`/api/roles/${created.id}`)) as { name: string };
    expect(detail.name).toBe("Head storekeeper");

    await api.delete("/api/roles/r1");
    const after = (await api.get("/api/roles")) as { id: string }[];
    expect(after.map((role) => role.id)).toEqual([created.id]);
  });

  it("builds a displayable provisional document (totals, pending number)", async () => {
    const order = (await api.post("/api/purchase-orders", {
      supplierId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      date: "2026-09-24",
      lines: [{ description: "Filter", quantity: 2, unitPriceCents: 1500, vatRateBp: 1600 }],
    })) as {
      id: string;
      number: string;
      totalHtCents: number;
      totalTtcCents: number;
      lines: { id: string; receivedQuantity: string }[];
    };
    expect(order.number).toBe(i18n.t("offline:write.pendingNumber"));
    expect(order.totalHtCents).toBe(3000);
    expect(order.totalTtcCents).toBe(3480);
    expect(order.lines[0].receivedQuantity).toBe("0");
    expect(await readCachedResponse(`/api/purchase-orders/${order.id}`)).toMatchObject({
      id: order.id,
    });
  });

  it("lets screens with a dedicated queue handle the network error themselves", async () => {
    await expect(api.post("/api/parties", { name: "Client" })).rejects.toBeInstanceOf(ApiError);
    await expect(api.post("/api/pos/tickets", {})).rejects.toBeInstanceOf(ApiError);
    await expect(api.post("/api/auth/login", {})).rejects.toBeInstanceOf(ApiError);
    expect(await offlineDb.outbox.count()).toBe(0);
  });
});

describe("replay at synchronization", () => {
  it("replays in order, once, resolving provisional identifiers", async () => {
    const category = (await api.post("/api/catalog/categories", { name: "Filters" })) as {
      id: string;
    };
    await api.patch(`/api/catalog/categories/${category.id}`, { name: "Oil filters" });
    const [create, update] = await offlineDb.outbox.orderBy("localSeq").toArray();

    const serverId = "0b6f1c2e-8d3a-4f5b-9c7d-1e2f3a4b5c6d";
    online = true;
    calls = [];
    routes = (call) => {
      if (call.url === "/api/health") return json({ status: "ok" });
      if (call.url.startsWith("/api/sync/snapshot")) {
        return json({ cursor: "c1", products: [], parties: [], modules: [] });
      }
      if (call.method === "POST") return json({ id: serverId, name: "Filters" }, 201);
      return json({ id: serverId, name: "Oil filters" });
    };

    await runSync({ force: true });

    const writes = calls.filter((call) => call.method !== "GET");
    expect(writes.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/catalog/categories",
      `PATCH /api/catalog/categories/${serverId}`,
    ]);
    expect(writes[0].headers["Idempotency-Key"]).toBe(create.clientUuid);
    expect(writes[1].headers["Idempotency-Key"]).toBe(update.clientUuid);

    const records = await offlineDb.outbox.toArray();
    expect(records.every((record) => record.status === "synced")).toBe(true);

    // A second cycle sends nothing.
    calls = [];
    await runSync({ force: true });
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("records a server rejection without blocking the following writes", async () => {
    await api.post("/api/warehouses", { code: "", name: "" });
    await api.post("/api/catalog/categories", { name: "Tyres" });

    online = true;
    routes = (call) => {
      if (call.url === "/api/health") return json({ status: "ok" });
      if (call.url.startsWith("/api/sync/snapshot")) return json({ cursor: "c1" });
      if (call.url === "/api/warehouses") {
        return json({ error: "Code is required", code: "VALIDATION_ERROR" }, 422);
      }
      return json({ id: "0b6f1c2e-8d3a-4f5b-9c7d-1e2f3a4b5c6d" }, 201);
    };
    await runSync({ force: true });

    const records = await offlineDb.outbox.orderBy("localSeq").toArray();
    expect(records.map((record) => record.status)).toEqual(["error", "synced"]);
    expect(records[0].lastError).toBe("Code is required");
  });
});
