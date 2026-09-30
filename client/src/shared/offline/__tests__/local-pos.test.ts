/**
 * The till of the offline-first desktop (`offline/local/local-pos.ts`): a sale is
 * recorded locally — ticket, payments, their operations, the stock and session figures
 * derived from them — then sent; the receipt carries the legal number when the network
 * gives it in time, the provisional one otherwise.
 */

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncTable } from "@shared/sync-protocol";
import { posApi } from "@/entities/pos/api";
import { checkout, closeSession, openSession } from "@/features/pos/checkout";
import { offlineDb } from "../db";
import { startLocalSession, stopLocalSession } from "../local/local-sync";
import { refreshReadiness } from "../local/replication";
import { FakeLocalDb } from "./fake-local-db";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";

type Row = Record<string, unknown>;

let fake: FakeLocalDb;
let online = true;
let pushed: Row[] = [];

function seed(entity: SyncTable, rows: Row[]) {
  for (const data of rows) {
    fake.table(entity).set(String(data.id), {
      id: String(data.id),
      version: 1,
      pending: false,
      deletedAt: null,
      data: { companyId: COMPANY, isActive: true, ...data },
    });
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Server: every operation accepted, a ticket gets its legal number. */
function accept(operation: Row) {
  pushed.push(operation);
  const id = String(operation.clientUuid);
  const record =
    operation.entity === "invoicing.sales_invoice"
      ? {
          entity: "sales_invoices",
          id,
          version: 1,
          data: { ...fake.table("sales_invoices").get(id)!.data, number: "FAC-2026-0042" },
        }
      : undefined;
  return {
    clientUuid: id,
    entity: operation.entity,
    status: "created",
    outcome: "success",
    serverId: id,
    assignedNumber: record ? "FAC-2026-0042" : undefined,
    record,
  };
}

beforeEach(async () => {
  fake = new FakeLocalDb();
  online = true;
  pushed = [];
  const memory = new Map<string, string>([
    ["erp.session.cache", JSON.stringify({ user: { id: USER }, company: { id: COMPANY } })],
  ]);
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
      if (!online) throw new TypeError("Failed to fetch");
      const url = new URL(input, "http://server.test");
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      if (url.pathname === "/api/sync/push") {
        return json({ results: (body as { operations: Row[] }).operations.map(accept) });
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
      return json({ cursor: "", products: [], modules: [] });
    })
  );
  await offlineDb.open();
  await offlineDb.outbox.clear();
  await startLocalSession(COMPANY);

  seed("pos_registers", [
    { id: "reg1", name: "Caisse 1", warehouseId: "w1", cashAccountId: "cash1" },
  ]);
  seed("stock_items", [
    { id: "st1", productId: "p1", warehouseId: "w1", lotNumber: "", quantity: "10.000" },
    { id: "st2", productId: "p1", warehouseId: "w2", lotNumber: "", quantity: "5.000" },
  ]);
  seed("parties", [{ id: "cu1", name: "Aminata" }]);
  fake.meta.set("bootstrap_completed_at", "2026-09-30T00:00:00.000Z");
  for (const entity of [
    "pos_registers",
    "pos_sessions",
    "sales_invoices",
    "payments",
    "stock_items",
    "parties",
  ] as SyncTable[]) {
    fake.progress.set(entity, { entity, afterId: null, rows: 0, total: null, done: true });
  }
  await refreshReadiness();
});

afterEach(async () => {
  await stopLocalSession();
  vi.unstubAllGlobals();
});

const sale = (sessionId: string) => ({
  sessionId,
  partyId: "cu1",
  lines: [
    {
      productId: "p1",
      sku: "RIZ",
      name: "Riz",
      unit: "kg",
      quantity: 3,
      unitPriceCents: 1000,
      discountBp: 0,
    },
  ],
  payments: [
    { method: "CASH" as const, amountCents: 2000 },
    { method: "MOBILE_MONEY" as const, amountCents: 1000 },
  ],
  localTicketSeq: 7,
});

describe("offline-first till", () => {
  it("opens a session locally, then sells without any network", async () => {
    online = false;
    const opened = await openSession(
      { registerId: "reg1", openingBalanceCents: 5000 },
      { online: false }
    );
    expect(opened.clientUuid).toBeNull();
    expect(await posApi.currentSessionFromServer()).toMatchObject({
      id: opened.sessionId,
      status: "OPEN",
    });

    const result = await checkout(sale(opened.sessionId), { online: false });
    expect(result).toMatchObject({ mode: "offline", number: "OFFLINE-TKT-0007", totalCents: 3000 });

    const invoice = fake.table("sales_invoices").get(result.invoiceId!)!;
    expect(invoice).toMatchObject({ pending: true, version: 0 });
    expect(invoice.data).toMatchObject({
      status: "PAID",
      paidAmountCents: 3000,
      posSessionId: opened.sessionId,
    });
    expect((invoice.data.lines as Row[])[0]).toMatchObject({ totalCents: 3000, quantity: "3" });
    expect([...fake.table("payments").values()].map((row) => row.data.amountCents)).toEqual([
      2000, 1000,
    ]);

    // Stock of the till's warehouse only, and the session figures: derived, not pending.
    expect(fake.table("stock_items").get("st1")).toMatchObject({
      pending: false,
      data: expect.objectContaining({ quantity: "7.000" }),
    });
    expect(fake.table("stock_items").get("st2")!.data.quantity).toBe("5.000");
    const session = fake.table("pos_sessions").get(opened.sessionId)!;
    expect(session.data).toMatchObject({
      totalSalesCents: 3000,
      totalCashCents: 2000,
      expectedBalanceCents: 7000,
      ticketCount: 1,
    });

    const summary = await posApi.sessionSummary(opened.sessionId);
    expect(summary.totals).toMatchObject({ totalCents: 3000, cashCents: 2000 });
    expect(summary.expectedBalanceCents).toBe(7000);
  });

  it("queues the ticket after its session, and payments after their ticket", async () => {
    online = false;
    const opened = await openSession(
      { registerId: "reg1", openingBalanceCents: 0 },
      { online: false }
    );
    const result = await checkout(sale(opened.sessionId), { online: false });

    const queue = [...fake.queue.values()].sort((a, b) => a.seq - b.seq);
    expect(queue.map((row) => row.entity)).toEqual([
      "pos.session_open",
      "invoicing.sales_invoice",
      "payments.payment",
      "payments.payment",
    ]);
    const [, ticket, payment] = queue;
    // The session is not on the server yet: named by its creation, with a dependency.
    expect(ticket.payload).toMatchObject({
      posSessionId: null,
      posSessionClientUuid: opened.sessionId,
      partyId: "cu1",
    });
    expect(ticket.dependsOn).toEqual([opened.sessionId]);
    expect(payment.dependsOn).toEqual([result.invoiceId, opened.sessionId]);
    expect(payment.payload).toMatchObject({
      invoiceClientUuid: result.invoiceId,
      amountCents: 2000,
      paymentMethod: "CASH",
    });
  });

  it("prints the legal number when the network gives it in time", async () => {
    seed("pos_sessions", [
      {
        id: "s1",
        registerId: "reg1",
        userId: USER,
        status: "OPEN",
        openingBalanceCents: 0,
        ticketCount: 0,
      },
    ]);
    const result = await checkout(sale("s1"), { online: true });
    expect(result).toMatchObject({ mode: "online", number: "FAC-2026-0042" });
    expect(pushed.map((operation) => operation.entity)).toEqual([
      "invoicing.sales_invoice",
      "payments.payment",
      "payments.payment",
    ]);
    // Session known to the server: named by its id.
    expect((pushed[0].payload as Row).posSessionId).toBe("s1");
    expect(fake.table("sales_invoices").get(result.invoiceId!)).toMatchObject({ pending: false });
  });

  it("refuses a sale on a closed session and closes with the difference counted here", async () => {
    online = false;
    const opened = await openSession(
      { registerId: "reg1", openingBalanceCents: 5000 },
      { online: false }
    );
    await checkout(sale(opened.sessionId), { online: false });

    const closed = await closeSession(
      { sessionId: opened.sessionId, closingBalanceCents: 6500 },
      { online: false }
    );
    expect(closed.differenceCents).toBe(-500);
    expect(fake.table("pos_sessions").get(opened.sessionId)!.data.status).toBe("CLOSED");
    expect(await posApi.currentSessionFromServer()).toBeNull();
    await expect(checkout(sale(opened.sessionId), { online: false })).rejects.toMatchObject({
      code: "POS_SESSION_CLOSED",
    });
  });
});
