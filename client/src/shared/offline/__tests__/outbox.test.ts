/**
 * Offline queue: persistence, causal order and acknowledgements.
 *
 * `fake-indexeddb` faithfully reproduces IndexedDB in memory: these tests therefore
 * check the real behavior of the device storage, including operations surviving a
 * "browser close" (§16.3 of the specification).
 */

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { offlineDb } from "../db";
import {
  acknowledge,
  countFailed,
  countPending,
  discard,
  enqueue,
  listAll,
  listPending,
  markSending,
  purgeSynced,
  retryFailed,
} from "../outbox";

beforeEach(async () => {
  await offlineDb.open();
  await offlineDb.outbox.clear();
  await offlineDb.meta.clear();
  await offlineDb.cache.clear();
});

describe("enqueueing", () => {
  it("assigns an idempotency identifier and an increasing sequence", async () => {
    const first = await enqueue({ entity: "core.party", payload: { name: "A" }, label: "A" });
    const second = await enqueue({ entity: "core.party", payload: { name: "B" }, label: "B" });

    expect(first.clientUuid).not.toBe(second.clientUuid);
    expect(second.localSeq).toBe(first.localSeq + 1);
    expect(first.status).toBe("pending");
  });

  it("accepts a provided identifier, to link an invoice to its payment", async () => {
    const invoiceUuid = "11111111-1111-4111-8111-111111111111";
    const invoice = await enqueue({
      clientUuid: invoiceUuid,
      entity: "invoicing.sales_invoice",
      payload: {},
      label: "Ticket",
    });
    const payment = await enqueue({
      entity: "payments.payment",
      payload: { invoiceClientUuid: invoiceUuid },
      label: "Payment",
      dependsOn: [invoiceUuid],
    });

    expect(invoice.clientUuid).toBe(invoiceUuid);
    expect(payment.dependsOn).toEqual([invoiceUuid]);
  });

  it("keeps operations after reopening the database", async () => {
    await enqueue({ entity: "core.party", payload: { name: "Persistent" }, label: "Party" });
    // Closing then reopening reproduces the browser being closed.
    offlineDb.close();
    await offlineDb.open();

    expect(await countPending()).toBe(1);
  });
});

describe("replay order", () => {
  it("returns operations in causal order, not insertion order", async () => {
    const a = await enqueue({ entity: "core.party", payload: {}, label: "1" });
    const b = await enqueue({ entity: "invoicing.sales_invoice", payload: {}, label: "2" });
    const c = await enqueue({ entity: "payments.payment", payload: {}, label: "3" });

    // Disturb the write order: the queue must stay sorted by `localSeq`.
    await offlineDb.outbox.update(b.clientUuid, { updatedAt: new Date(0).toISOString() });

    const pending = await listPending();
    expect(pending.map((record) => record.clientUuid)).toEqual([
      a.clientUuid,
      b.clientUuid,
      c.clientUuid,
    ]);
  });
});

describe("acknowledgements", () => {
  it("removes a created or duplicate operation from the queue", async () => {
    const record = await enqueue({ entity: "core.party", payload: {}, label: "Party" });
    await markSending([record.clientUuid]);
    await acknowledge({
      clientUuid: record.clientUuid,
      status: "synced",
      serverId: "srv-1",
      assignedNumber: "CLI-0001",
    });

    expect(await countPending()).toBe(0);
    const [stored] = await listAll();
    expect(stored.status).toBe("synced");
    expect(stored.assignedNumber).toBe("CLI-0001");
  });

  it("keeps a deferred operation in the queue", async () => {
    const record = await enqueue({ entity: "payments.payment", payload: {}, label: "Payment" });
    await acknowledge({
      clientUuid: record.clientUuid,
      status: "deferred",
      error: "missing dependency",
    });

    // A deferral must be replayed: the operation stays sendable.
    const pending = await listPending();
    expect(pending.map((entry) => entry.clientUuid)).toContain(record.clientUuid);
  });

  it("counts attempts and allows retrying errors", async () => {
    const record = await enqueue({ entity: "core.party", payload: {}, label: "Party" });
    await acknowledge({
      clientUuid: record.clientUuid,
      status: "error",
      error: "server rejection",
    });

    expect(await countFailed()).toBe(1);
    const [failed] = await listAll();
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("server rejection");

    await retryFailed();
    expect(await countFailed()).toBe(0);
    expect(await countPending()).toBe(1);
  });

  it("discards an operation only on explicit request", async () => {
    const record = await enqueue({ entity: "core.party", payload: {}, label: "Party" });
    await acknowledge({ clientUuid: record.clientUuid, status: "error", error: "rejected" });

    // The automatic purge never touches an unsynchronized operation.
    await purgeSynced(0);
    expect(await countFailed()).toBe(1);

    await discard(record.clientUuid);
    expect(await countFailed()).toBe(0);
  });
});

describe("purge", () => {
  it("only deletes old synchronized operations", async () => {
    const synced = await enqueue({ entity: "core.party", payload: {}, label: "Old" });
    await acknowledge({ clientUuid: synced.clientUuid, status: "synced", serverId: "srv" });
    await offlineDb.outbox.update(synced.clientUuid, {
      updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const pending = await enqueue({ entity: "core.party", payload: {}, label: "Recent" });

    const removed = await purgeSynced(7);
    expect(removed).toBe(1);

    const remaining = await listAll();
    expect(remaining.map((record) => record.clientUuid)).toEqual([pending.clientUuid]);
  });
});
