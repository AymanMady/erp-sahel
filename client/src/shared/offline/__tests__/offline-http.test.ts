/**
 * File générique des écritures hors ligne : toute page doit pouvoir enregistrer sans
 * réseau, afficher aussitôt la saisie, puis la rejouer une seule fois au retour du
 * réseau.
 */

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/shared/api/http";
import { ApiError } from "@/shared/api/api-error";
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

describe("lectures hors ligne", () => {
  it("réaffiche les rôles déjà consultés", async () => {
    online = true;
    routes = () => json([{ id: "r1", name: "Caissier" }]);
    await api.get("/api/roles");
    await new Promise((resolve) => setTimeout(resolve, 10));

    online = false;
    expect(await api.get("/api/roles")).toEqual([{ id: "r1", name: "Caissier" }]);
  });
});

describe("écritures hors ligne", () => {
  it("met l'écriture en file, avec la clé d'idempotence déjà envoyée", async () => {
    const created = (await api.post("/api/roles", { name: "Magasinier", permissions: [] })) as {
      id: string;
      name: string;
    };

    const [record] = await offlineDb.outbox.toArray();
    expect(record.entity).toBe(HTTP_REQUEST_ENTITY);
    expect(record.payload).toMatchObject({ method: "POST", url: "/api/roles" });
    // Le premier essai portait déjà la clé : si le serveur l'a reçu, le rejeu ne
    // créera rien de plus.
    expect(calls[0].headers["Idempotency-Key"]).toBe(record.clientUuid);
    expect(created).toMatchObject({ id: record.clientUuid, name: "Magasinier" });
  });

  it("affiche aussitôt la saisie dans la liste et la fiche", async () => {
    await storeCachedResponse("/api/roles", [{ id: "r1", name: "Caissier" }]);

    const created = (await api.post("/api/roles", { name: "Magasinier" })) as { id: string };
    const roles = (await api.get("/api/roles")) as { id: string; name: string }[];
    expect(roles.map((role) => role.name)).toEqual(["Magasinier", "Caissier"]);

    await api.patch(`/api/roles/${created.id}`, { name: "Chef magasinier" });
    const detail = (await readCachedResponse(`/api/roles/${created.id}`)) as { name: string };
    expect(detail.name).toBe("Chef magasinier");

    await api.delete("/api/roles/r1");
    const after = (await api.get("/api/roles")) as { id: string }[];
    expect(after.map((role) => role.id)).toEqual([created.id]);
  });

  it("construit un document provisoire affichable (totaux, numéro en attente)", async () => {
    const order = (await api.post("/api/purchase-orders", {
      supplierId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      date: "2026-09-24",
      lines: [{ description: "Filtre", quantity: 2, unitPriceCents: 1500, vatRateBp: 1600 }],
    })) as {
      id: string;
      number: string;
      totalHtCents: number;
      totalTtcCents: number;
      lines: { id: string; receivedQuantity: string }[];
    };
    expect(order.number).toBe("En attente");
    expect(order.totalHtCents).toBe(3000);
    expect(order.totalTtcCents).toBe(3480);
    expect(order.lines[0].receivedQuantity).toBe("0");
    expect(await readCachedResponse(`/api/purchase-orders/${order.id}`)).toMatchObject({
      id: order.id,
    });
  });

  it("laisse les écrans à file dédiée gérer eux-mêmes l'erreur réseau", async () => {
    await expect(api.post("/api/parties", { name: "Client" })).rejects.toBeInstanceOf(ApiError);
    await expect(api.post("/api/pos/tickets", {})).rejects.toBeInstanceOf(ApiError);
    await expect(api.post("/api/auth/login", {})).rejects.toBeInstanceOf(ApiError);
    expect(await offlineDb.outbox.count()).toBe(0);
  });
});

describe("rejeu à la synchronisation", () => {
  it("rejoue dans l'ordre, une fois, en résolvant les identifiants provisoires", async () => {
    const category = (await api.post("/api/catalog/categories", { name: "Filtres" })) as {
      id: string;
    };
    await api.patch(`/api/catalog/categories/${category.id}`, { name: "Filtres à huile" });
    const [create, update] = await offlineDb.outbox.orderBy("localSeq").toArray();

    const serverId = "0b6f1c2e-8d3a-4f5b-9c7d-1e2f3a4b5c6d";
    online = true;
    calls = [];
    routes = (call) => {
      if (call.url === "/api/health") return json({ status: "ok" });
      if (call.url.startsWith("/api/sync/snapshot")) {
        return json({ cursor: "c1", products: [], parties: [], modules: [] });
      }
      if (call.method === "POST") return json({ id: serverId, name: "Filtres" }, 201);
      return json({ id: serverId, name: "Filtres à huile" });
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

    // Un second cycle ne renvoie rien.
    calls = [];
    await runSync({ force: true });
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("consigne un refus du serveur sans bloquer les écritures suivantes", async () => {
    await api.post("/api/warehouses", { code: "", name: "" });
    await api.post("/api/catalog/categories", { name: "Pneus" });

    online = true;
    routes = (call) => {
      if (call.url === "/api/health") return json({ status: "ok" });
      if (call.url.startsWith("/api/sync/snapshot")) return json({ cursor: "c1" });
      if (call.url === "/api/warehouses") {
        return json({ error: "Code obligatoire", code: "VALIDATION_ERROR" }, 422);
      }
      return json({ id: "0b6f1c2e-8d3a-4f5b-9c7d-1e2f3a4b5c6d" }, 201);
    };
    await runSync({ force: true });

    const records = await offlineDb.outbox.orderBy("localSeq").toArray();
    expect(records.map((record) => record.status)).toEqual(["error", "synced"]);
    expect(records[0].lastError).toBe("Code obligatoire");
  });
});
