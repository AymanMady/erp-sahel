/**
 * Mode hors ligne des écrans de gestion : cache des lectures `GET` et mise en file
 * des créations faites dans les formulaires.
 */

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "@/shared/api/api-error";
import { offlineDb } from "../db";
import { readCachedResponse, storeCachedResponse } from "../http-cache";
import {
  onlineOrQueued,
  pendingParties,
  queueInvoiceCreate,
  queuePartyCreate,
  queueQuoteCreate,
} from "../offline-writes";

beforeEach(async () => {
  await offlineDb.open();
  await offlineDb.outbox.clear();
  await offlineDb.meta.clear();
  await offlineDb.cache.clear();
});

const networkError = () =>
  new ApiError({ status: 0, code: "NETWORK_ERROR", message: "x", isNetworkError: true });

describe("cache des lectures", () => {
  it("relit une réponse par son URL, quel que soit l'ordre des paramètres", async () => {
    await storeCachedResponse("/api/invoices/abc?b=2&a=1", { id: "abc" });
    expect(await readCachedResponse("/api/invoices/abc?a=1&b=2")).toEqual({ id: "abc" });
  });

  it("reconstitue une page à partir d'une liste préchargée plus large", async () => {
    const items = Array.from({ length: 60 }, (_, index) => ({ id: String(index) }));
    await storeCachedResponse("/api/invoices?limit=200&offset=0", {
      items,
      total: 60,
      limit: 200,
      offset: 0,
    });

    const page2 = (await readCachedResponse("/api/invoices?limit=25&offset=25")) as {
      items: { id: string }[];
      total: number;
      offset: number;
    };
    expect(page2.items.map((row) => row.id)).toEqual(items.slice(25, 50).map((row) => row.id));
    expect(page2.total).toBe(60);
    expect(page2.offset).toBe(25);
  });

  it("ne mélange pas des listes aux filtres différents", async () => {
    await storeCachedResponse("/api/invoices?limit=200&offset=0", { items: [{ id: "1" }] });
    expect(await readCachedResponse("/api/invoices?limit=25&offset=0&status=PAID")).toBe(undefined);
  });

  it("ne conserve jamais l'authentification, mais garde l'administration consultable", async () => {
    await storeCachedResponse("/api/auth/me", { id: "u" });
    await storeCachedResponse("/api/users", [{ id: "u" }]);
    await storeCachedResponse("/api/roles", [{ id: "r" }]);
    await storeCachedResponse("/api/sync/status", { stats: {} });
    expect(await readCachedResponse("/api/auth/me")).toBe(undefined);
    expect(await readCachedResponse("/api/users")).toEqual([{ id: "u" }]);
    expect(await readCachedResponse("/api/roles")).toEqual([{ id: "r" }]);
    expect(await readCachedResponse("/api/sync/status")).toEqual({ stats: {} });
  });

  it("applique localement recherche, statut et dates à une liste préchargée", async () => {
    await storeCachedResponse("/api/invoices?limit=200&offset=0", {
      items: [
        { id: "1", number: "FAC-1", status: "PAID", partyName: "Garage Atlas", date: "2026-09-01" },
        {
          id: "2",
          number: "FAC-2",
          status: "DRAFT",
          partyName: "Sahel Motors",
          date: "2026-09-10",
        },
        { id: "3", number: "FAC-3", status: "PAID", partyName: "Sahel Pneus", date: "2026-09-20" },
      ],
      total: 3,
      limit: 200,
      offset: 0,
    });

    const paid = (await readCachedResponse("/api/invoices?limit=25&offset=0&status=PAID")) as {
      items: { id: string }[];
      total: number;
    };
    expect(paid.items.map((row) => row.id)).toEqual(["1", "3"]);
    expect(paid.total).toBe(2);

    const search = (await readCachedResponse(
      "/api/invoices?limit=25&offset=0&search=sahel&fromDate=2026-09-15"
    )) as { items: { id: string }[] };
    expect(search.items.map((row) => row.id)).toEqual(["3"]);
  });
});

describe("créations hors ligne", () => {
  it("met en file seulement si le serveur est injoignable", async () => {
    const offline = await onlineOrQueued(
      () => Promise.reject(networkError()),
      () => Promise.resolve("queued")
    );
    expect(offline).toEqual({ mode: "offline", result: "queued" });

    const refusal = new ApiError({ status: 422, code: "VALIDATION_ERROR", message: "refus" });
    await expect(
      onlineOrQueued(
        () => Promise.reject(refusal),
        () => Promise.resolve("queued")
      )
    ).rejects.toBe(refusal);
  });

  it("rend un tiers créé hors ligne aussitôt sélectionnable", async () => {
    const party = await queuePartyCreate({ name: "Garage Nouveau", partyType: "CUSTOMER" });
    const pending = await pendingParties();
    expect(pending.map((row) => row.id)).toEqual([party.id]);
    expect(pending[0].name).toBe("Garage Nouveau");
  });

  it("lie un devis au tiers créé hors ligne par dépendance", async () => {
    const party = await queuePartyCreate({ name: "Client local", partyType: "CUSTOMER" });
    const { provisionalNumber } = await queueQuoteCreate({
      partyId: party.id,
      date: "2026-09-23",
      lines: [{ description: "Filtre", quantity: 2, unitPriceCents: 1500 }],
    });

    const quote = (await offlineDb.outbox.toArray()).find((row) => row.entity === "sales.quote");
    expect(provisionalNumber).toMatch(/^OFFLINE-DEV-/);
    expect(quote?.payload.partyId).toBeNull();
    expect(quote?.payload.partyClientUuid).toBe(party.id);
    expect(quote?.dependsOn).toEqual([party.id]);
  });

  it("référence directement un tiers déjà connu du serveur", async () => {
    const serverId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    await queueInvoiceCreate({
      partyId: serverId,
      date: "2026-09-23",
      lines: [{ description: "Pièce", quantity: 1, unitPriceCents: 1000 }],
    });
    const [invoice] = await offlineDb.outbox.toArray();
    expect(invoice.payload.partyId).toBe(serverId);
    expect(invoice.payload.partyClientUuid).toBeNull();
    expect(invoice.dependsOn).toEqual([]);
  });
});
