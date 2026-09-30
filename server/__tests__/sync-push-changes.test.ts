/**
 * Offline changes of reference data (`server/domains/sync/master-data.ts`): updates,
 * deletions, conflicts, and the id an offline creation keeps on the server.
 *
 * The conflict scenario is the one of the specification: two workstations start from
 * a product at 100 MRU; A sets 120 offline, B sets 130 offline; both reconnect.
 */

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALL_PERMISSION_CODES, DEFAULT_ROLES, resolveRolePermissions } from "@shared/rbac";
import { categories, parties, products, services } from "@shared/schema";
import type { SyncOperationInput, SyncOperationResult } from "@shared/sync-protocol";
import { closeDatabase, db } from "../db";
import { syncApplication } from "../domains/sync/application";
import { conflictingFields } from "../domains/sync/master-data";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

let context: TestContext;
let seq = 0;

beforeAll(async () => {
  context = await createTestCompany("push-changes");
});

afterAll(async () => {
  await dropTestCompany(context);
  await closeDatabase();
});

function push(
  operations: Partial<SyncOperationInput>[],
  permissions: readonly string[] = ALL_PERMISSION_CODES
): Promise<SyncOperationResult[]> {
  return syncApplication.push(
    {
      company: context.company,
      userId: context.userId,
      deviceId: "desk-test",
      isSuperuser: false,
      permissions,
    },
    operations.map((operation) => ({
      clientUuid: randomUUID(),
      localSeq: (seq += 1),
      action: "create",
      dependsOn: [],
      createdAt: new Date().toISOString(),
      payload: {},
      ...operation,
    })) as SyncOperationInput[]
  );
}

function update(
  entity: SyncOperationInput["entity"],
  entityId: string,
  baseVersion: number,
  changes: Record<string, unknown>,
  base: Record<string, unknown> = {}
): Partial<SyncOperationInput> {
  return { entity, action: "update", entityId, baseVersion, payload: { changes, base } };
}

async function product(id: string) {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row;
}

describe("creations made offline", () => {
  it("keep the id the workstation gave them", async () => {
    const partyId = randomUUID();
    const categoryId = randomUUID();
    const serviceId = randomUUID();
    const results = await push([
      { clientUuid: partyId, entity: "core.party", payload: { name: "Offline customer" } },
      { clientUuid: categoryId, entity: "catalog.category", payload: { name: "Drinks" } },
      {
        clientUuid: serviceId,
        entity: "services.service",
        payload: { code: `SRV-${seq}`, name: "Delivery", priceCents: 50_000 },
      },
    ]);
    expect(results.map((result) => result.outcome)).toEqual(["success", "success", "success"]);
    expect(results.map((result) => result.serverId)).toEqual([partyId, categoryId, serviceId]);
    expect((await db.select().from(parties).where(eq(parties.id, partyId))).length).toBe(1);
    expect((await db.select().from(categories).where(eq(categories.id, categoryId))).length).toBe(
      1
    );
    expect((await db.select().from(services).where(eq(services.id, serviceId))).length).toBe(1);
    // The server row comes back with the acknowledgement: stored at once.
    expect(results[0].record).toMatchObject({ entity: "parties", id: partyId, version: 1 });
  });
});

describe("offline updates", () => {
  it("are applied and answered with the new server row", async () => {
    const created = await createStockedProduct(context);
    const [result] = await push([
      update("catalog.product", created.id, 1, { name: "Rice 25 kg" }, { name: created.name }),
    ]);
    expect(result.outcome).toBe("success");
    expect(result.record?.data.name).toBe("Rice 25 kg");
    expect(result.record?.version).toBe(2);
    expect((await product(created.id)).name).toBe("Rice 25 kg");
  });

  it("report a conflict when two workstations change the same price", async () => {
    const created = await createStockedProduct(context, { salePriceCents: 100_00 });
    const base = { salePriceCents: 100_00 };

    const [first] = await push([
      update("catalog.product", created.id, 1, { salePriceCents: 120_00 }, base),
    ]);
    const [second] = await push([
      update("catalog.product", created.id, 1, { salePriceCents: 130_00 }, base),
    ]);

    expect(first.outcome).toBe("success");
    expect(second.outcome).toBe("conflict");
    expect(second.status).toBe("conflict");
    expect(second.conflictFields).toEqual(["salePriceCents"]);
    // Nothing written over the first change, and the server version comes back.
    expect((await product(created.id)).salePriceCents).toBe(120_00);
    expect(second.record?.data.salePriceCents).toBe(120_00);
    expect(second.record?.version).toBe(2);
  });

  it("apply the local price once the person keeps it, on the server version", async () => {
    const created = await createStockedProduct(context, { salePriceCents: 100_00 });
    await push([
      update(
        "catalog.product",
        created.id,
        1,
        { salePriceCents: 120_00 },
        { salePriceCents: 100_00 }
      ),
    ]);
    const [kept] = await push([
      update(
        "catalog.product",
        created.id,
        2,
        { salePriceCents: 130_00 },
        { salePriceCents: 120_00 }
      ),
    ]);
    expect(kept.outcome).toBe("success");
    expect((await product(created.id)).salePriceCents).toBe(130_00);
  });

  it("let the last change win on a field that is not sensitive", async () => {
    const created = await createStockedProduct(context);
    const base = { description: "" };
    await push([update("catalog.product", created.id, 1, { description: "From A" }, base)]);
    const [last] = await push([
      update("catalog.product", created.id, 1, { description: "From B" }, base),
    ]);
    expect(last.outcome).toBe("success");
    expect((await product(created.id)).description).toBe("From B");
  });

  it("apply a price the server did not touch, even on an older version", async () => {
    const created = await createStockedProduct(context, { salePriceCents: 100_00 });
    await push([
      update("catalog.product", created.id, 1, { name: "Renamed by A" }, { name: created.name }),
    ]);
    const [price] = await push([
      update(
        "catalog.product",
        created.id,
        1,
        { salePriceCents: 90_00 },
        { salePriceCents: 100_00 }
      ),
    ]);
    expect(price.outcome).toBe("success");
    const row = await product(created.id);
    expect(row.salePriceCents).toBe(90_00);
    expect(row.name).toBe("Renamed by A");
  });

  it("are applied once when the same operation is sent twice", async () => {
    const created = await createStockedProduct(context);
    const operation = {
      ...update("catalog.product", created.id, 1, { name: "Once" }, { name: created.name }),
      clientUuid: randomUUID(),
    };
    const [first] = await push([operation]);
    const versionAfterFirst = (await product(created.id)).version;
    const [again] = await push([operation]);
    expect(first.status).toBe("created");
    expect(again.status).toBe("duplicate");
    expect(again.outcome).toBe("success");
    expect((await product(created.id)).version).toBe(versionAfterFirst);
  });

  it("report a conflict on a party's credit limit", async () => {
    const [created] = await push([{ entity: "core.party", payload: { name: "Credit customer" } }]);
    const id = created.serverId!;
    const base = { creditLimitCents: 0 };
    await push([update("core.party", id, 1, { creditLimitCents: 500_00 }, base)]);
    const [second] = await push([update("core.party", id, 1, { creditLimitCents: 900_00 }, base)]);
    expect(second.outcome).toBe("conflict");
    expect(second.conflictFields).toEqual(["creditLimitCents"]);
  });

  it("are validated like the online form", async () => {
    const created = await createStockedProduct(context);
    const [result] = await push([update("catalog.product", created.id, 1, { name: "" }, {})]);
    expect(result.outcome).toBe("failed");
    expect((await product(created.id)).name).not.toBe("");
  });

  it("are refused to someone without the online right", async () => {
    const created = await createStockedProduct(context);
    const cashier = resolveRolePermissions(
      DEFAULT_ROLES.find((role) => role.slug === "vendeur")!.permissions
    );
    const [result] = await push(
      [update("catalog.product", created.id, 1, { name: "Nope" }, {})],
      cashier
    );
    expect(result.outcome).toBe("failed");
    expect((await product(created.id)).name).not.toBe("Nope");
  });
});

describe("offline deletions", () => {
  it("archive the row, and succeed again on an already archived or missing one", async () => {
    const created = await createStockedProduct(context);
    const [archived] = await push([
      { entity: "catalog.product", action: "delete", entityId: created.id, baseVersion: 1 },
    ]);
    expect(archived.outcome).toBe("success");
    expect((await product(created.id)).isActive).toBe(false);
    expect(archived.record?.data.isActive).toBe(false);

    const [again] = await push([
      { entity: "catalog.product", action: "delete", entityId: created.id },
    ]);
    const [missing] = await push([
      { entity: "catalog.product", action: "delete", entityId: randomUUID() },
    ]);
    expect(again.outcome).toBe("success");
    expect(missing.outcome).toBe("success");
  });
});

describe("conflict rule", () => {
  const rule = (overrides: Partial<Parameters<typeof conflictingFields>[0]>) =>
    conflictingFields({
      sensitive: ["price"],
      current: { price: 120, name: "server" },
      currentVersion: 2,
      baseVersion: 1,
      changes: { price: 130 },
      base: { price: 100 },
      ...overrides,
    });

  it("finds a sensitive field changed on both sides", () => {
    expect(rule({})).toEqual(["price"]);
  });
  it("sees nothing when the row did not move", () => {
    expect(rule({ baseVersion: 2 })).toEqual([]);
  });
  it("sees nothing when both sides chose the same value", () => {
    expect(rule({ changes: { price: 120 } })).toEqual([]);
  });
  it("ignores fields that are not sensitive", () => {
    expect(rule({ changes: { name: "mine" }, base: { name: "old" } })).toEqual([]);
  });
  it("counts a field without base value as changed on the server", () => {
    expect(rule({ base: {} })).toEqual(["price"]);
  });
});
