/**
 * First synchronization and pull of an offline-first workstation
 * (`server/domains/sync/replication.ts`).
 *
 * The central test plays a workstation: it downloads page after page while the server
 * keeps changing (creations, updates, a deletion), then pulls from the bootstrap cursor.
 * Its copy must end up identical to the server — nothing missed, nothing duplicated.
 */

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALL_PERMISSION_CODES, DEFAULT_ROLES, resolveRolePermissions } from "@shared/rbac";
import { bankAccounts, companySettings, salesInvoices } from "@shared/schema";
import { SYNC_TABLES, type SyncRecord, type SyncTable } from "@shared/sync-protocol";
import { closeDatabase, db } from "../db";
import { catalogApplication } from "../domains/catalog/application";
import { invoicingApplication } from "../domains/invoicing/application";
import { partiesApplication } from "../domains/parties/application";
import { loadRecords, syncEntity } from "../domains/sync/entities";
import { replicationApplication, type ReplicationContext } from "../domains/sync/replication";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

let context: TestContext;
let admin: ReplicationContext;
let cashier: ReplicationContext;

beforeAll(async () => {
  context = await createTestCompany("replication");
  admin = {
    companyId: context.company.id,
    userId: context.userId,
    isSuperuser: false,
    permissions: ALL_PERMISSION_CODES,
  };
  const cashierRole = DEFAULT_ROLES.find((role) => role.slug === "vendeur")!;
  cashier = { ...admin, permissions: resolveRolePermissions(cashierRole.permissions) };
});

afterAll(async () => {
  await dropTestCompany(context);
  await closeDatabase();
});

/** A workstation copy: what `local_db` does, reduced to a map with the version guard. */
class Workstation {
  rows = new Map<string, SyncRecord>();
  cursor = 0;

  private key(entity: string, id: string) {
    return `${entity}:${id}`;
  }

  store(entity: string, record: SyncRecord) {
    const current = this.rows.get(this.key(entity, record.id));
    if (current && current.version > record.version) return;
    this.rows.set(this.key(entity, record.id), record);
  }

  remove(entity: string, id: string) {
    this.rows.delete(this.key(entity, id));
  }

  ids(entity: SyncTable) {
    return [...this.rows.keys()]
      .filter((key) => key.startsWith(`${entity}:`))
      .map((key) => key.slice(entity.length + 1))
      .sort();
  }

  async bootstrap(who: ReplicationContext, betweenPages?: () => Promise<void>, limit = 2) {
    const start = await replicationApplication.bootstrapStart(who);
    for (const { entity } of start.entities) {
      let after: string | undefined;
      for (;;) {
        const page = await replicationApplication.bootstrapPage(who, entity, {
          after,
          limit,
          since: start.since,
        });
        for (const row of page.rows) this.store(entity, row);
        await betweenPages?.();
        if (page.done) break;
        after = page.nextAfter ?? undefined;
      }
    }
    this.cursor = start.cursor;
    return start;
  }

  async pull(who: ReplicationContext) {
    for (;;) {
      const page = await replicationApplication.pull(who, { cursor: this.cursor, limit: 3 });
      for (const change of page.changes) {
        if (change.operation === "DELETE") this.remove(change.entity, change.entityId);
        else
          this.store(change.entity, {
            id: change.entityId,
            version: change.version!,
            data: change.data!,
          });
      }
      this.cursor = page.cursor;
      if (!page.hasMore) return page;
    }
  }
}

async function serverIds(entity: SyncTable) {
  const definition = syncEntity(entity);
  const rows = await db
    .select({ id: definition.id })
    .from(definition.table)
    .where(eq(definition.company, context.company.id));
  return rows.map((row) => String(row.id));
}

describe("first synchronization", () => {
  it("offers every readable entity, in dependency order, with its row count", async () => {
    await createStockedProduct(context);
    const start = await replicationApplication.bootstrapStart(admin);
    const names = start.entities.map((entry) => entry.entity);
    expect(names).toEqual(SYNC_TABLES.filter((name) => names.includes(name)));
    expect(names).toContain("products");
    expect(start.entities.find((entry) => entry.entity === "products")!.total).toBeGreaterThan(0);
    expect(start.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("only offers a cashier what a cashier may see", async () => {
    const start = await replicationApplication.bootstrapStart(cashier);
    const names = start.entities.map((entry) => entry.entity);
    expect(names).toEqual(
      expect.arrayContaining(["products", "parties", "pos_sessions", "sales_invoices"])
    );
    expect(names).not.toContain("purchase_orders");
    await expect(
      replicationApplication.bootstrapPage(cashier, "purchase_orders", { limit: 10 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sends a product with its variants, and never bank details", async () => {
    const product = await createStockedProduct(context);
    await catalogApplication.update(context.company.id, product.id, {
      variants: [{ sku: "S", barcode: "S-1", attributes: {}, isDefault: false }],
    });
    const [record] = (
      await loadRecords(db, syncEntity("products"), context.company.id, [product.id])
    ).values();
    expect((record.data.variants as { sku: string }[]).map((variant) => variant.sku)).toEqual([
      "S",
    ]);

    const [account] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.companyId, context.company.id))
      .limit(1);
    const [bank] = (
      await loadRecords(db, syncEntity("bank_accounts"), context.company.id, [account.id])
    ).values();
    expect(bank.data).not.toHaveProperty("iban");
    expect(bank.data).not.toHaveProperty("balanceCents");
    expect(bank.data.name).toBe(account.name);
  });

  it("sends an invoice with its lines, and only recent or unsettled documents", async () => {
    const product = await createStockedProduct(context);
    const customer = await partiesApplication.create(
      context.company.id,
      { name: "Window customer", partyType: "CUSTOMER" },
      db
    );
    const make = async () => {
      const invoice = await invoicingApplication.create(
        context.company,
        { partyId: customer.id, lines: [{ productId: product.id, quantity: 1, description: "A" }] },
        context.userId
      );
      return invoice.id;
    };
    const recent = await make();
    const oldPaid = await make();
    const oldUnpaid = await make();
    await db
      .update(salesInvoices)
      .set({ date: "2020-01-01", status: "PAID" })
      .where(eq(salesInvoices.id, oldPaid));
    await db
      .update(salesInvoices)
      .set({ date: "2020-01-01", status: "VALIDATED" })
      .where(eq(salesInvoices.id, oldUnpaid));

    const workstation = new Workstation();
    await workstation.bootstrap(admin, undefined, 50);
    const ids = workstation.ids("sales_invoices");
    expect(ids).toContain(recent);
    expect(ids).toContain(oldUnpaid);
    expect(ids).not.toContain(oldPaid);
    const stored = workstation.rows.get(`sales_invoices:${recent}`)!;
    expect((stored.data.lines as unknown[]).length).toBe(1);
  });
});

describe("bootstrap then pull", () => {
  it("converges to the server state while the server keeps changing", async () => {
    const setting = async (value: string) =>
      (
        await db
          .insert(companySettings)
          .values({ companyId: context.company.id, key: `conv-${randomUUID()}`, value })
          .returning()
      )[0];
    const doomed = await setting("to delete");
    const renamed = await createStockedProduct(context);

    let step = 0;
    const workstation = new Workstation();
    await workstation.bootstrap(admin, async () => {
      step += 1;
      // Changes between pages: before and after the pages of their entity.
      if (step === 1) await setting("created during bootstrap");
      if (step === 2) await db.delete(companySettings).where(eq(companySettings.id, doomed.id));
      if (step === 3) {
        await catalogApplication.update(context.company.id, renamed.id, {
          name: "Renamed while downloading",
        });
      }
      if (step === 4) await createStockedProduct(context);
    });
    await workstation.pull(admin);

    for (const entity of ["company_settings", "products", "stock_items"] as SyncTable[]) {
      expect(workstation.ids(entity)).toEqual((await serverIds(entity)).sort());
    }
    const product = workstation.rows.get(`products:${renamed.id}`)!;
    expect(product.data.name).toBe("Renamed while downloading");
    const [server] = (
      await loadRecords(db, syncEntity("products"), context.company.id, [renamed.id])
    ).values();
    expect(product.version).toBe(server.version);
    expect(workstation.rows.has(`company_settings:${doomed.id}`)).toBe(false);
  });

  it("sends each changed row once per page, in its latest state", async () => {
    const workstation = new Workstation();
    await workstation.bootstrap(admin, undefined, 500);
    const product = await createStockedProduct(context);
    await catalogApplication.update(context.company.id, product.id, { name: "v2" });
    await catalogApplication.update(context.company.id, product.id, { name: "v3" });

    const page = await replicationApplication.pull(admin, {
      cursor: workstation.cursor,
      limit: 500,
    });
    const mine = page.changes.filter((change) => change.entityId === product.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].data?.name).toBe("v3");
  });

  it("sends a document again when only one of its lines changed", async () => {
    const product = await createStockedProduct(context);
    const customer = await partiesApplication.create(
      context.company.id,
      { name: "Lines customer", partyType: "CUSTOMER" },
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
    const workstation = new Workstation();
    await workstation.bootstrap(admin, undefined, 500);

    await invoicingApplication.update(context.company, draft.id, {
      lines: [
        { productId: product.id, quantity: 1, description: "A" },
        { productId: product.id, quantity: 2, description: "B" },
      ],
    });
    await workstation.pull(admin);
    const lines = workstation.rows.get(`sales_invoices:${draft.id}`)!.data.lines as {
      description: string;
    }[];
    expect(lines.map((line) => line.description)).toEqual(["A", "B"]);
  });

  it("tells a person which entities they may receive, and leaves the others out", async () => {
    const workstation = new Workstation();
    await workstation.bootstrap(cashier, undefined, 500);
    const page = await workstation.pull(cashier);
    expect(page.scope).not.toContain("purchase_orders");
    expect(page.changes.some((change) => change.entity === "purchase_orders")).toBe(false);
  });

  it("moves the cursor forward even when nothing changed", async () => {
    const workstation = new Workstation();
    await workstation.bootstrap(admin, undefined, 500);
    const before = workstation.cursor;
    const page = await workstation.pull(admin);
    expect(page.changes).toEqual([]);
    expect(page.cursor).toBeGreaterThanOrEqual(before);
  });
});
