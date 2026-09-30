/**
 * Offline-first desktop (`offline/local/`): the scenarios of the specification, played
 * against a simulated server and the in-memory stand-in of the local database.
 *
 *  1. first launch online: server → local database;
 *  2. launch offline after the first synchronization: the data is there;
 *  3–5. changes made offline wait in `sync_queue`;
 *  6. network back: push, then pull, queue cleared, cursor moved;
 *  7. network lost during the first synchronization: resumed after the last page;
 *  8. answer lost: the same operation sent again, same id;
 *  9. conflict: kept with both versions;
 * 10. window closed while sending: sent again at the next start.
 */

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncOperationResult } from "@shared/sync-protocol";
import { offlineDb, type OutboxRecord } from "../db";
import { enqueue } from "../outbox";
import { getSyncStatus, runSync } from "../sync-engine";
import { localDb } from "../local/local-db";
import { startLocalSession, stopLocalSession } from "../local/local-sync";
import { isLocalReady } from "../local/replication";
import { FakeLocalDb } from "./fake-local-db";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let fake: FakeLocalDb;
let online = true;
let calls: { method: string; url: string; body: unknown }[] = [];
/** Server behaviors a test can change. */
let server: {
  products: { id: string; version: number; name: string }[];
  pageSize: number;
  failPage?: (after: string | null) => boolean;
  pullCursor: number;
  pullChanges: unknown[];
  scope: string[];
  resyncOnce: boolean;
  push: (operations: Record<string, unknown>[]) => SyncOperationResult[] | "lost";
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function product(id: string, name: string, version = 1) {
  return { id, version, name };
}

function success(operation: Record<string, unknown>): SyncOperationResult {
  return {
    clientUuid: String(operation.clientUuid),
    entity: operation.entity as SyncOperationResult["entity"],
    status: "created",
    outcome: "success",
    serverId: String(operation.clientUuid),
    record: {
      entity: "parties",
      id: String(operation.clientUuid),
      version: 1,
      data: { id: operation.clientUuid, companyId: COMPANY, name: "Server copy" },
    },
  };
}

function route(method: string, url: URL, body: unknown): Response {
  const path = url.pathname;
  if (path === "/api/health") return json({ status: "ok" });
  if (path === "/api/sync/bootstrap" && method === "POST") {
    return json({
      cursor: 100,
      since: "2025-09-30",
      entities: [
        { entity: "parties", total: 0 },
        { entity: "products", total: server.products.length },
      ],
    });
  }
  const page = path.match(/^\/api\/sync\/bootstrap\/(\w+)$/);
  if (page) {
    const after = url.searchParams.get("after");
    if (server.failPage?.(after)) throw new TypeError("Failed to fetch");
    const all = page[1] === "products" ? server.products : [];
    const rest = all.filter((row) => !after || row.id > after);
    const rows = rest.slice(0, server.pageSize);
    const done = rest.length <= server.pageSize;
    return json({
      entity: page[1],
      rows: rows.map((row) => ({
        id: row.id,
        version: row.version,
        data: { ...row, companyId: COMPANY, isActive: true },
      })),
      nextAfter: done ? null : rows[rows.length - 1].id,
      done,
    });
  }
  if (path === "/api/sync/pull" && url.searchParams.has("cursor")) {
    if (server.resyncOnce) {
      server.resyncOnce = false;
      return json({ cursor: 0, hasMore: false, resync: true, scope: server.scope, changes: [] });
    }
    const changes = server.pullChanges;
    server.pullChanges = [];
    return json({
      cursor: server.pullCursor,
      hasMore: false,
      resync: false,
      scope: server.scope,
      changes,
    });
  }
  // Former snapshot path, still refreshed for the offline sign-in.
  if (path === "/api/sync/pull") return json({ cursor: new Date().toISOString(), products: [] });
  if (path === "/api/sync/snapshot") {
    return json({
      cursor: new Date().toISOString(),
      company: { id: COMPANY },
      products: [],
      modules: [],
    });
  }
  if (path === "/api/sync/push") {
    const operations = (body as { operations: Record<string, unknown>[] }).operations;
    const results = server.push(operations);
    if (results === "lost") throw new TypeError("Failed to fetch");
    return json({ results, cursor: "", serverTime: "" });
  }
  return json({});
}

beforeEach(async () => {
  fake = new FakeLocalDb();
  online = true;
  calls = [];
  server = {
    products: [product("p1", "Riz"), product("p2", "Sucre"), product("p3", "Huile")],
    pageSize: 2,
    pullCursor: 150,
    pullChanges: [],
    scope: ["parties", "products"],
    resyncOnce: false,
    push: (operations) => operations.map(success),
  };
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
      calls.push({ method: init.method ?? "GET", url: url.pathname + url.search, body });
      if (!online) throw new TypeError("Failed to fetch");
      return route(init.method ?? "GET", url, body);
    })
  );
  await offlineDb.open();
  await offlineDb.outbox.clear();
  await offlineDb.meta.clear();
  await offlineDb.cache.clear();
});

afterEach(async () => {
  await stopLocalSession();
  vi.unstubAllGlobals();
});

const bootstrapPages = () =>
  calls
    .filter((call) => call.url.startsWith("/api/sync/bootstrap/products"))
    .map((call) => call.url);

describe("first synchronization", () => {
  it("1. downloads the server data into the local database, then pulls from the bootstrap cursor", async () => {
    await startLocalSession(COMPANY);
    await runSync({ force: true });

    expect([...fake.table("products").keys()].sort()).toEqual(["p1", "p2", "p3"]);
    expect(fake.meta.get("bootstrap_completed_at")).toBeTruthy();
    expect(isLocalReady("products")).toBe(true);
    // The pull started from the cursor taken before the first page.
    expect(calls.some((call) => call.url.includes("/api/sync/pull?cursor=100"))).toBe(true);
    expect(fake.meta.get("last_sync_cursor")).toBe("150");
    expect(getSyncStatus().state).toBe("idle");
  });

  it("7. resumes after the last page stored when the network drops in the middle", async () => {
    server.failPage = (after) => after === "p2";
    await startLocalSession(COMPANY);
    await runSync({ force: true });

    expect(getSyncStatus().state).not.toBe("idle");
    expect([...fake.table("products").keys()].sort()).toEqual(["p1", "p2"]);
    expect(fake.progress.get("products")).toMatchObject({ afterId: "p2", done: false });
    expect(isLocalReady("products")).toBe(false);
    expect(fake.meta.get("last_sync_cursor")).toBeUndefined();

    server.failPage = undefined;
    calls = [];
    await runSync({ force: true });
    expect(isLocalReady("products")).toBe(true);
    // Resumed after p2: the first page is not downloaded again.
    expect(bootstrapPages()).toHaveLength(1);
    expect(bootstrapPages()[0]).toContain("after=p2");
    // Same bootstrap, same cursor: the pull starts where the pages started.
    expect(calls.filter((call) => call.url === "/api/sync/bootstrap")).toHaveLength(0);
    expect(calls.some((call) => call.url.includes("cursor=100"))).toBe(true);
  });

  it("2. works offline at the next launch, from the local database", async () => {
    await startLocalSession(COMPANY);
    await runSync({ force: true });
    await stopLocalSession();

    online = false;
    await startLocalSession(COMPANY);
    expect(isLocalReady("products")).toBe(true);
    const { rows } = await localDb.query({ entity: "products" });
    expect(rows).toHaveLength(3);
    await runSync({ force: true });
    expect(getSyncStatus().state).toBe("offline");
  });

  it("downloads everything again when the server log no longer covers the cursor, keeping the queue", async () => {
    await startLocalSession(COMPANY);
    await runSync({ force: true });
    online = false;
    await enqueue({ entity: "core.party", payload: { name: "Kept" }, label: "Kept" });
    online = true;
    server.push = () => "lost";
    server.resyncOnce = true;
    calls = [];

    await runSync({ force: true });
    // Push lost (network): nothing pulled, nothing lost.
    expect(fake.queue.size).toBe(1);

    server.push = (operations) => operations.map(success);
    await runSync({ force: true });
    expect(calls.filter((call) => call.url === "/api/sync/bootstrap").length).toBe(1);
    expect(isLocalReady("products")).toBe(true);
    expect([...fake.queue.values()][0].status).toBe("synced");
  });

  it("stops reading locally an entity this person may no longer receive", async () => {
    await startLocalSession(COMPANY);
    await runSync({ force: true });
    expect(isLocalReady("parties")).toBe(true);

    server.scope = ["products"];
    await runSync({ force: true });
    expect(isLocalReady("parties")).toBe(false);
    expect(isLocalReady("products")).toBe(true);
    expect(fake.log.some((entry) => entry.event === "entity.stale")).toBe(true);
  });
});

describe("changes made offline", () => {
  it("3. wait in sync_queue, written before their IndexedDB copy", async () => {
    await startLocalSession(COMPANY);
    online = false;
    const record = await enqueue({
      entity: "core.party",
      payload: { name: "Offline" },
      label: "Offline",
    });

    const queued = fake.queue.get(record.clientUuid)!;
    expect(queued).toMatchObject({ entity: "core.party", operation: "CREATE", status: "pending" });
    expect(await offlineDb.outbox.get(record.clientUuid)).toBeTruthy();
    expect(fake.calls.indexOf("local_write")).toBeGreaterThanOrEqual(0);
  });

  it("6. are sent when the network is back, then the changes are pulled and the cursor moves", async () => {
    await startLocalSession(COMPANY);
    await runSync({ force: true });
    online = false;
    const record = await enqueue({
      entity: "core.party",
      payload: { name: "Offline" },
      label: "Offline",
    });

    online = true;
    calls = [];
    server.pullCursor = 180;
    await runSync({ force: true });

    const push = calls.findIndex((call) => call.url === "/api/sync/push");
    const pull = calls.findIndex((call) => call.url.includes("/api/sync/pull?cursor="));
    expect(push).toBeGreaterThanOrEqual(0);
    expect(pull).toBeGreaterThan(push);
    expect(fake.queue.get(record.clientUuid)!.status).toBe("synced");
    expect(fake.table("parties").get(record.clientUuid)).toMatchObject({
      pending: false,
      version: 1,
    });
    expect(fake.meta.get("last_sync_cursor")).toBe("180");
    expect(getSyncStatus().pending).toBe(0);
    // The IndexedDB copy follows.
    expect((await offlineDb.outbox.get(record.clientUuid))?.status).toBe("synced");
  });

  it("8. are sent again with the same id when the answer is lost", async () => {
    await startLocalSession(COMPANY);
    await runSync({ force: true });
    const record = await enqueue({
      entity: "core.party",
      payload: { name: "Once" },
      label: "Once",
    });

    server.push = () => "lost";
    await runSync({ force: true });
    expect(fake.queue.get(record.clientUuid)!.status).toBe("pending");

    server.push = (operations) =>
      operations.map((operation) => ({ ...success(operation), status: "duplicate" }));
    await runSync({ force: true });
    const sent = calls
      .filter((call) => call.url === "/api/sync/push")
      .map(
        (call) => (call.body as { operations: { clientUuid: string }[] }).operations[0].clientUuid
      );
    expect(sent).toEqual([record.clientUuid, record.clientUuid]);
    expect(fake.queue.get(record.clientUuid)!.status).toBe("synced");
  });

  it("9. keep a conflict with both versions, without losing the local one", async () => {
    await startLocalSession(COMPANY);
    await runSync({ force: true });
    await localDb.write({
      rows: [
        {
          entity: "products",
          id: "p1",
          data: { id: "p1", companyId: COMPANY, name: "Riz", salePriceCents: 12000 },
        },
      ],
      queue: [
        {
          id: "op-price",
          entity: "catalog.product",
          localTable: "products",
          entityId: "p1",
          operation: "UPDATE",
          payload: { changes: { salePriceCents: 12000 }, base: { salePriceCents: 10000 } },
          baseVersion: 1,
        },
      ],
    });
    server.push = (operations) =>
      operations.map((operation) => ({
        clientUuid: String(operation.clientUuid),
        entity: "catalog.product",
        status: "conflict",
        outcome: "conflict",
        conflictFields: ["salePriceCents"],
        record: {
          entity: "products",
          id: "p1",
          version: 2,
          data: { id: "p1", companyId: COMPANY, salePriceCents: 13000 },
        },
      }));

    await runSync({ force: true });
    expect(getSyncStatus().conflicts).toBe(1);
    const [conflict] = await localDb.conflictsOpen();
    expect(conflict).toMatchObject({ fields: ["salePriceCents"], serverVersion: 2 });
    expect(fake.table("products").get("p1")?.data.salePriceCents).toBe(12000);
  });

  it("10. left sending by a closed window go back to the queue at the next start", async () => {
    await startLocalSession(COMPANY);
    const record = await enqueue({
      entity: "core.party",
      payload: { name: "Crash" },
      label: "Crash",
    });
    await localDb.queueMarkSending([record.clientUuid]);
    await stopLocalSession();

    await startLocalSession(COMPANY);
    expect(fake.queue.get(record.clientUuid)!.status).toBe("pending");
    expect(fake.log.some((entry) => entry.event === "queue.recovered")).toBe(true);
    await runSync({ force: true });
    expect(fake.queue.get(record.clientUuid)!.status).toBe("synced");
  });
});

describe("former outbox", () => {
  function legacy(
    clientUuid: string,
    localSeq: number,
    status: OutboxRecord["status"]
  ): OutboxRecord {
    const now = new Date().toISOString();
    return {
      clientUuid,
      localSeq,
      entity: "core.party",
      action: "create",
      payload: { name: clientUuid },
      dependsOn: [],
      status,
      attempts: 0,
      lastError: null,
      provisionalNumber: null,
      assignedNumber: null,
      serverId: null,
      createdAt: now,
      updatedAt: now,
      label: clientUuid,
      amountCents: null,
    };
  }

  it("moves unsent operations into sync_queue once, same id and order, and keeps the originals", async () => {
    await offlineDb.cache.put({
      key: "sync.snapshot",
      value: { company: { id: COMPANY } },
      updatedAt: "",
    });
    await offlineDb.outbox.bulkPut([
      legacy("a", 5, "pending"),
      legacy("b", 6, "error"),
      legacy("c", 4, "synced"),
    ]);
    fake.legacyOutbox = [
      {
        clientUuid: "d",
        localSeq: 7,
        entity: "core.party",
        payload: "{}",
        dependsOn: "[]",
        status: "pending",
        attempts: 0,
        lastError: null,
        label: "",
      },
    ];

    await startLocalSession(COMPANY);
    expect([...fake.queue.values()].map((row) => [row.id, row.seq, row.status])).toEqual([
      ["a", 5, "pending"],
      ["b", 6, "failed"],
      ["d", 7, "pending"],
    ]);
    expect(await offlineDb.outbox.count()).toBe(3);

    await stopLocalSession();
    await startLocalSession(COMPANY);
    expect(fake.queue.size).toBe(3);
  });

  it("leaves the operations of another company where they are", async () => {
    await offlineDb.cache.put({
      key: "sync.snapshot",
      value: { company: { id: OTHER } },
      updatedAt: "",
    });
    await offlineDb.outbox.put(legacy("a", 1, "pending"));
    await startLocalSession(COMPANY);
    expect(fake.queue.size).toBe(0);
    expect(fake.meta.get("legacy_outbox_imported_at")).toBeUndefined();
    expect(fake.log.some((entry) => entry.event === "legacy.other_company")).toBe(true);
  });
});
