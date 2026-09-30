/**
 * Change log and row versions filled by PostgreSQL (migration 0006), and the pull
 * cursor that reads them (`server/domains/sync/changes.ts`).
 */

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { companySettings, products, salesInvoices } from "@shared/schema";
import { closeDatabase, db, pool } from "../db";
import { catalogApplication } from "../domains/catalog/application";
import { invoicingApplication } from "../domains/invoicing/application";
import { partiesApplication } from "../domains/parties/application";
import { syncChangesRepository } from "../domains/sync/changes";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

let context: TestContext;

beforeAll(async () => {
  context = await createTestCompany("changes");
});

afterAll(async () => {
  await dropTestCompany(context);
  await closeDatabase();
});

/** Every change of the test company logged after `cursor`, whatever the page size. */
async function changesSince(cursor: number) {
  const page = await syncChangesRepository.read(context.company.id, cursor, 10_000);
  return page.changes;
}

async function versionOf(table: typeof products | typeof salesInvoices, id: string) {
  const [row] = await db.select({ version: table.version }).from(table).where(eq(table.id, id));
  return row.version;
}

describe("row versions", () => {
  it("start at 1 and go up on every change, without application code", async () => {
    const product = await createStockedProduct(context);
    expect(await versionOf(products, product.id)).toBe(1);

    await catalogApplication.update(context.company.id, product.id, { name: "Renamed" });
    expect(await versionOf(products, product.id)).toBe(2);

    await db.update(products).set({ salePriceCents: 1 }).where(eq(products.id, product.id));
    expect(await versionOf(products, product.id)).toBe(3);
  });

  it("do not move when an update changes nothing", async () => {
    const product = await createStockedProduct(context);
    await db.update(products).set({ name: product.name }).where(eq(products.id, product.id));
    expect(await versionOf(products, product.id)).toBe(1);
  });

  it("go up on the parent when its lines or variants change", async () => {
    const product = await createStockedProduct(context);
    await catalogApplication.update(context.company.id, product.id, {
      variants: [{ sku: "S", barcode: "", attributes: {}, isDefault: false }],
    });
    // The product row itself was not written: only its variants.
    expect(await versionOf(products, product.id)).toBeGreaterThan(1);

    const customer = await partiesApplication.create(
      context.company.id,
      { name: "Customer", partyType: "CUSTOMER" },
      db
    );
    const draft = await invoicingApplication.create(
      context.company,
      {
        partyId: customer.id,
        validate: false,
        lines: [{ productId: product.id, quantity: 1, description: "A" }],
      },
      context.userId
    );
    const before = await versionOf(salesInvoices, draft.id);
    const cursor = await syncChangesRepository.currentCursor();
    await invoicingApplication.update(context.company, draft.id, {
      lines: [{ productId: product.id, quantity: 2, description: "B" }],
    });
    expect(await versionOf(salesInvoices, draft.id)).toBeGreaterThan(before);
    const logged = await changesSince(cursor);
    expect(logged.some((change) => change.entity === "sales_invoices")).toBe(true);
    // Lines are never an entity of their own: the document travels whole.
    expect(logged.some((change) => change.entity.endsWith("_lines"))).toBe(false);
  });
});

describe("change log", () => {
  it("records inserts, updates and physical deletes", async () => {
    const cursor = await syncChangesRepository.currentCursor();
    const [setting] = await db
      .insert(companySettings)
      .values({ companyId: context.company.id, key: `k-${randomUUID()}`, value: "1" })
      .returning();
    await db.update(companySettings).set({ value: "2" }).where(eq(companySettings.id, setting.id));
    await db.delete(companySettings).where(eq(companySettings.id, setting.id));

    const ops = (await changesSince(cursor))
      .filter((change) => change.entityId === setting.id)
      .map((change) => change.op);
    expect(ops).toEqual(["I", "U", "D"]);
  });

  it("only serves the changes of the company asked for", async () => {
    const other = await createTestCompany("changes-other");
    try {
      const cursor = await syncChangesRepository.currentCursor();
      await createStockedProduct(other);
      expect(await changesSince(cursor)).toEqual([]);
    } finally {
      await dropTestCompany(other);
    }
  });
});

describe("pull cursor", () => {
  const insertSetting = (client: { query: (text: string, values: unknown[]) => unknown }) =>
    client.query("insert into company_settings (company_id, key, value) values ($1, $2, '')", [
      context.company.id,
      `k-${randomUUID()}`,
    ]);

  it("never steps over a transaction that commits after a later one", async () => {
    const cursor = await syncChangesRepository.currentCursor();
    const slow = await pool.connect();
    const fast = await pool.connect();
    try {
      // `slow` writes first (lower transaction id and seq) but commits last.
      await slow.query("begin");
      await insertSetting(slow);
      await fast.query("begin");
      await insertSetting(fast);
      await fast.query("commit");

      // `fast` has committed, but serving it would move the cursor past `slow`.
      const early = await syncChangesRepository.read(context.company.id, cursor, 100);
      expect(early.changes).toEqual([]);
      expect(early.cursor).toBeLessThan(
        Number((await slow.query("select pg_current_xact_id()::text as id")).rows[0].id)
      );

      await slow.query("commit");
      const late = await syncChangesRepository.read(context.company.id, early.cursor, 100);
      expect(late.changes.filter((change) => change.entity === "company_settings")).toHaveLength(2);
    } finally {
      await slow.query("rollback").catch(() => undefined);
      slow.release();
      fast.release();
    }
  });

  it("pages on transaction boundaries and serves a large transaction whole", async () => {
    const cursor = await syncChangesRepository.currentCursor();
    await db.transaction(async (tx) => {
      for (let index = 0; index < 3; index += 1) {
        await tx
          .insert(companySettings)
          .values({ companyId: context.company.id, key: `big-${randomUUID()}`, value: "" });
      }
    });
    await db
      .insert(companySettings)
      .values({ companyId: context.company.id, key: `after-${randomUUID()}`, value: "" });

    const first = await syncChangesRepository.read(context.company.id, cursor, 2);
    expect(first.changes).toHaveLength(3);
    expect(new Set(first.changes.map((change) => change.txid)).size).toBe(1);
    expect(first.hasMore).toBe(true);

    const second = await syncChangesRepository.read(context.company.id, first.cursor, 2);
    expect(second.changes).toHaveLength(1);
    expect(second.hasMore).toBe(false);

    // Nothing is served twice once the cursor has moved.
    const third = await syncChangesRepository.read(context.company.id, second.cursor, 2);
    expect(third.changes).toEqual([]);
  });

  it("asks for a full download when the log no longer covers the cursor", async () => {
    const cursor = await syncChangesRepository.currentCursor();
    const [{ purged }] = (
      await db.execute<{ purged: string }>(
        sql`select purged_txid::text as purged from sync_horizon where id = 1`
      )
    ).rows;
    try {
      await db.execute(
        sql`update sync_horizon set purged_txid = ${String(cursor + 1)}::xid8 where id = 1`
      );
      const page = await syncChangesRepository.read(context.company.id, cursor, 100);
      expect(page.resync).toBe(true);
    } finally {
      await db.execute(sql`update sync_horizon set purged_txid = ${purged}::xid8 where id = 1`);
    }
  });

  it("purges old rows and remembers how far", async () => {
    const [setting] = await db
      .insert(companySettings)
      .values({ companyId: context.company.id, key: `old-${randomUUID()}`, value: "" })
      .returning();
    await db.execute(
      sql`update sync_changes set changed_at = now() - interval '40 days' where entity_id = ${setting.id}`
    );
    const [{ purged: before }] = (
      await db.execute<{ purged: string }>(
        sql`select purged_txid::text as purged from sync_horizon where id = 1`
      )
    ).rows;
    try {
      expect(await syncChangesRepository.purge(30)).toBeGreaterThanOrEqual(1);
      expect(await syncChangesRepository.purgedUpTo()).toBeGreaterThan(Number(before));
      const left = await db.execute(
        sql`select 1 from sync_changes where entity_id = ${setting.id}`
      );
      expect(left.rows).toHaveLength(0);
    } finally {
      await db.execute(sql`update sync_horizon set purged_txid = ${before}::xid8 where id = 1`);
      await db.delete(companySettings).where(and(eq(companySettings.id, setting.id)));
    }
  });
});
