/**
 * Preparation of the device for work without internet (`offline-prefetch.ts`): every
 * page gets its data at the first connection, and a single page the server fails never
 * leaves the others without theirs.
 */

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SYNC_TABLES } from "@shared/sync-protocol";
import { probeServer } from "@/shared/api/network";
import { getMeta, offlineDb, setMeta } from "../db";
import { readCachedResponse } from "../http-cache";
import { startLocalSession, stopLocalSession } from "../local/local-sync";
import { refreshReadiness } from "../local/replication";
import { getOfflineReadiness, prefetchForOffline } from "../offline-prefetch";
import { FakeLocalDb } from "./fake-local-db";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const MODULES = [
  "pos",
  "invoicing",
  "sales",
  "purchasing",
  "inventory",
  "services",
  "banking",
  "accounting",
  "reports",
];

let online = true;
let requests: string[] = [];
/** Answer of the server for a path, when it is not the usual empty one. */
let answer: (path: string) => Response | "offline" | undefined = () => undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A server with a little of everything: one customer, one invoice. */
function serve(path: string): Response {
  if (path === "/api/health/db") return json({ status: "ok" });
  if (path === "/api/sync/snapshot") {
    return json({
      cursor: "1",
      modules: MODULES.map((code) => ({ code, name: code })),
      parties: [{ id: "c1", name: "Aïcha", updatedAt: "2026-09-30T08:00:00.000Z" }],
      session: null,
    });
  }
  if (path === "/api/invoices") {
    return json({ items: [{ id: "i1", updatedAt: "2026-09-30T08:00:00.000Z" }], total: 1 });
  }
  if (path.startsWith("/api/invoices/") || path.startsWith("/api/parties/")) {
    return json({ id: path.split("/").pop(), updatedAt: "2026-09-30T08:00:00.000Z" });
  }
  if (path === "/api/goods-receipts" || path === "/api/users" || path === "/api/roles") {
    return json([]);
  }
  return json({ items: [], total: 0 });
}

let fake: FakeLocalDb | null = null;

beforeEach(async () => {
  online = true;
  requests = [];
  answer = () => undefined;
  fake = null;
  const memory = new Map<string, string>();
  vi.stubGlobal("window", {
    get __TAURI_INTERNALS__() {
      return fake
        ? {
            invoke: (command: string, args?: Record<string, unknown>) =>
              fake!.invoke(command, args),
          }
        : undefined;
    },
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal("navigator", {
    get onLine() {
      return online;
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://server.test");
      if (url.pathname !== "/api/health/db") requests.push(url.pathname);
      const special = answer(url.pathname);
      if (special === "offline" || !online) throw new TypeError("Failed to fetch");
      return special ?? serve(url.pathname);
    })
  );
  await offlineDb.open();
  await offlineDb.cache.clear();
  await offlineDb.meta.clear();
  await offlineDb.outbox.clear();
  await probeServer(true);
});

afterEach(async () => {
  await stopLocalSession().catch(() => undefined);
  vi.unstubAllGlobals();
});

const times = (path: string) => requests.filter((request) => request === path).length;

describe("preparation of the device", () => {
  it("downloads every page, then says the device is ready", async () => {
    await prefetchForOffline({ force: true });

    expect(await readCachedResponse("/api/roles")).toEqual([]);
    expect(await readCachedResponse("/api/invoices/i1")).toMatchObject({ id: "i1" });
    expect(await readCachedResponse("/api/parties/c1")).toMatchObject({ id: "c1" });
    expect(await getMeta("prefetch.completedAt")).not.toBeNull();
    expect(getOfflineReadiness()).toMatchObject({ state: "ready", running: false });
  });

  it("skips a page the person may not see, and is still ready", async () => {
    answer = (path) =>
      path === "/api/users" ? json({ error: "Forbidden", code: "FORBIDDEN" }, 403) : undefined;
    await prefetchForOffline({ force: true });

    expect(times("/api/users")).toBe(1);
    expect(await getMeta("prefetch.completedAt")).not.toBeNull();
  }, 20_000);

  it("keeps downloading the other pages when the server fails one, and tries it again soon", async () => {
    answer = (path) =>
      path === "/api/reports/stock" ? json({ error: "Boom", code: "INTERNAL" }, 500) : undefined;
    const before = Date.now();
    await prefetchForOffline({ force: true });

    // Tried again after the others, a few times.
    expect(times("/api/reports/stock")).toBe(3);
    // Every other page is there, the documents' details included.
    expect(await readCachedResponse("/api/roles")).toEqual([]);
    expect(await readCachedResponse("/api/invoices/i1")).toMatchObject({ id: "i1" });
    // Not ready yet: the next pass comes in 2 minutes, not in 15.
    expect(await getMeta("prefetch.completedAt")).toBeNull();
    const nextRun = Number(await getMeta("prefetch.nextRunAt"));
    expect(nextRun - before).toBeGreaterThanOrEqual(2 * 60_000);
    expect(nextRun - Date.now()).toBeLessThanOrEqual(2 * 60_000);
    expect(getOfflineReadiness().state).toBe("preparing");
  }, 30_000);

  it("stops when the network drops, and starts again as soon as it is back", async () => {
    answer = (path) => {
      if (path === "/api/inventory/valuation") online = false;
      return undefined;
    };
    await prefetchForOffline({ force: true });

    expect(await getMeta("prefetch.completedAt")).toBeNull();
    // Nothing recorded: no waiting once the network is back.
    expect(await getMeta("prefetch.nextRunAt")).toBeNull();
    const asked = requests.length;
    expect(asked).toBeLessThan(20);

    online = true;
    answer = () => undefined;
    await probeServer(true);
    await prefetchForOffline();
    expect(requests.length).toBeGreaterThan(asked);
    expect(await getMeta("prefetch.completedAt")).not.toBeNull();
  }, 20_000);

  it("waits 15 minutes before refreshing a device that is ready", async () => {
    await prefetchForOffline({ force: true });
    const asked = requests.length;

    await prefetchForOffline();
    expect(requests.length).toBe(asked);
  }, 20_000);

  it("prepares right away a device updated from an earlier release", async () => {
    // What an earlier release left: its last pass a minute ago, never complete.
    await setMeta("prefetch.lastRunAt", String(Date.now() - 60_000));

    await prefetchForOffline();
    expect(times("/api/roles")).toBe(1);
    expect(await getMeta("prefetch.completedAt")).not.toBeNull();
  }, 20_000);
});

describe("preparation of the desktop", () => {
  it("downloads no document its local database already holds", async () => {
    fake = new FakeLocalDb();
    await startLocalSession(COMPANY);
    fake.meta.set("bootstrap_completed_at", "2026-09-30T00:00:00.000Z");
    for (const entity of SYNC_TABLES) {
      fake.progress.set(entity, { entity, afterId: null, rows: 0, total: null, done: true });
    }
    await refreshReadiness();

    await prefetchForOffline({ force: true });

    for (const path of [
      "/api/invoices",
      "/api/credit-notes",
      "/api/quotes",
      "/api/sales-orders",
      "/api/payments",
      "/api/purchase-orders",
      "/api/goods-receipts",
      "/api/supplier-invoices",
    ]) {
      expect(times(path), path).toBe(0);
    }
    expect(requests.some((path) => path.startsWith("/api/invoices/"))).toBe(false);
    expect(requests.some((path) => path.startsWith("/api/parties/"))).toBe(false);
    // What the local database does not hold is downloaded as on the web.
    expect(times("/api/dashboard")).toBe(3);
    expect(times("/api/roles")).toBe(1);
    expect(await getMeta("prefetch.completedAt")).not.toBeNull();
  }, 20_000);

  it("downloads the documents as on the web while the local database is not complete", async () => {
    fake = new FakeLocalDb();
    await startLocalSession(COMPANY);

    await prefetchForOffline({ force: true });

    expect(times("/api/invoices")).toBe(1);
    expect(await readCachedResponse("/api/invoices/i1")).toMatchObject({ id: "i1" });
  }, 20_000);
});
