/**
 * Regressions of the September 2026 review (`rapport.md` §3): each scenario that was
 * reproduced then — account takeover, rights bypassed through synchronization, money
 * errors on returns and payments — must stay impossible.
 */

import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  roles,
  salesInvoices,
  stockItems,
  syncDevices,
  userCompanies,
  userRoles,
  users,
} from "@shared/schema";
import { closeDatabase, db } from "../db";
import { createApp } from "../app";
import { hashPassword } from "../domains/auth/application";
import { invoicingApplication } from "../domains/invoicing/application";
import { partiesApplication } from "../domains/parties/application";
import { paymentsApplication } from "../domains/payments/application";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

const PASSWORD = "Test1234!";

let server: Server;
let baseUrl: string;
let context: TestContext;
let other: TestContext;
const createdUsers: string[] = [];

/** Creates a person with a system role in the company; returns their id and name. */
async function createMember(
  target: TestContext,
  roleSlug: string,
  options: { isSuperuser?: boolean } = {}
) {
  const username = `m-${randomUUID().slice(0, 8)}`;
  const [user] = await db
    .insert(users)
    .values({
      username,
      passwordHash: await hashPassword(PASSWORD),
      isSuperuser: options.isSuperuser ?? false,
    })
    .returning();
  createdUsers.push(user.id);
  await db.insert(userCompanies).values({ userId: user.id, companyId: target.company.id });
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.slug, roleSlug), isNull(roles.companyId)))
    .limit(1);
  await db
    .insert(userRoles)
    .values({ userId: user.id, roleId: role.id, companyId: target.company.id });
  return { id: user.id, username };
}

async function login(username: string, password = PASSWORD): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

function call(method: string, path: string, token: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Device-Id": "review-device",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function stockOf(productId: string): Promise<number> {
  const rows = await db.select().from(stockItems).where(eq(stockItems.productId, productId));
  return rows.reduce((sum, row) => sum + Number(row.quantity), 0);
}

beforeAll(async () => {
  const app = await createApp();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context = await createTestCompany("review");
  other = await createTestCompany("review-other");
});

afterAll(async () => {
  server.close();
  for (const userId of createdUsers) await db.delete(users).where(eq(users.id, userId));
  await dropTestCompany(context);
  await dropTestCompany(other);
  await closeDatabase();
});

describe("accounts (§3.1)", () => {
  it("does not let a shop administrator take over the platform administrator", async () => {
    const admin = await createMember(context, "administrateur");
    const platform = await createMember(context, "administrateur", { isSuperuser: true });
    const token = await login(admin.username);

    const response = await call("PATCH", `/api/users/${platform.id}`, token, {
      password: "Hacked12345",
    });
    // Hidden from companies: for them, the account does not exist.
    expect(response.status).toBe(404);
    // The old password still works: nothing changed.
    await login(platform.username);
  });

  it("hides the platform administrator and the technical screens from a shop administrator", async () => {
    const admin = await createMember(context, "administrateur");
    const platform = await createMember(context, "administrateur", { isSuperuser: true });
    const adminToken = await login(admin.username);

    const listed = (await (await call("GET", "/api/users", adminToken)).json()) as {
      id: string;
    }[];
    expect(listed.some((user) => user.id === admin.id)).toBe(true);
    expect(listed.some((user) => user.id === platform.id)).toBe(false);

    for (const path of [
      "/api/sync/status",
      "/api/sync/journal",
      "/api/system/overview",
      "/api/system/backup",
    ]) {
      expect((await call("GET", path, adminToken)).status, path).toBe(403);
    }
    const restore = await call("POST", "/api/system/restore", adminToken, {});
    expect(restore.status).toBe(403);

    const platformToken = await login(platform.username);
    expect((await call("GET", "/api/sync/status", platformToken)).status).toBe(200);
    const overview = await call("GET", "/api/system/overview", platformToken);
    expect(overview.status).toBe(200);
    const body = (await overview.json()) as { tables: { name: string }[] };
    expect(body.tables.some((table) => table.name === "users")).toBe(true);
  });

  it("does not let the platform administrator change its password in the application", async () => {
    const platform = await createMember(context, "administrateur", { isSuperuser: true });
    const token = await login(platform.username);
    const response = await call("POST", "/api/auth/change-password", token, {
      currentPassword: PASSWORD,
      newPassword: "Another12345",
      confirmPassword: "Another12345",
    });
    expect(response.status).toBe(422);
    await login(platform.username);
  });

  it("does not let one shop change the password of someone working in another shop", async () => {
    const admin = await createMember(context, "administrateur");
    const shared = await createMember(other, "vendeur");
    await db.insert(userCompanies).values({ userId: shared.id, companyId: context.company.id });
    const token = await login(admin.username);

    const response = await call("PATCH", `/api/users/${shared.id}`, token, {
      password: "Hacked12345",
    });
    expect(response.status).toBe(403);
  });

  it("closes open sessions at once when an account is disabled", async () => {
    const admin = await createMember(context, "administrateur");
    const cashier = await createMember(context, "vendeur");
    const adminToken = await login(admin.username);
    const cashierToken = await login(cashier.username);
    expect((await call("GET", "/api/auth/me", cashierToken)).status).toBe(200);

    const disabled = await call("PATCH", `/api/users/${cashier.id}`, adminToken, {
      isActive: false,
    });
    expect(disabled.status).toBe(200);
    expect((await call("GET", "/api/auth/me", cashierToken)).status).toBe(401);
  });
});

describe("synchronization rights (§3.2, §3.3)", () => {
  it("does not let a read-only account change the stock through synchronization", async () => {
    const product = await createStockedProduct(context, { quantity: 10 });
    const reader = await createMember(context, "consultation");
    const token = await login(reader.username);

    const response = await call("POST", "/api/sync/push", token, {
      deviceId: "review-device",
      operations: [
        {
          clientUuid: randomUUID(),
          localSeq: 1,
          entity: "inventory.stock_movement",
          action: "create",
          dependsOn: [],
          createdAt: new Date().toISOString(),
          payload: {
            productId: product.id,
            warehouseId: context.warehouseId,
            movementType: "OUT",
            quantity: 1,
            reason: "",
          },
        },
      ],
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: { status: string }[] };
    expect(body.results[0].status).toBe("error");
    expect(await stockOf(product.id)).toBe(10);
  });

  it("sends password hashes only to an approved computer, and never an administrator's", async () => {
    await createMember(context, "administrateur");
    const cashier = await createMember(context, "vendeur");
    const token = await login(cashier.username);

    const before = await call("GET", "/api/sync/snapshot?platform=desktop", token);
    const beforeBody = (await before.json()) as { offlineAuthUsers: unknown[] };
    expect(beforeBody.offlineAuthUsers).toEqual([]);

    await db
      .update(syncDevices)
      .set({ offlineLoginAllowed: true })
      .where(
        and(
          eq(syncDevices.companyId, context.company.id),
          eq(syncDevices.deviceId, "review-device")
        )
      );
    const after = await call("GET", "/api/sync/snapshot?platform=desktop", token);
    const afterBody = (await after.json()) as {
      offlineAuthUsers: { username: string; isSuperuser: boolean; permissions: string[] }[];
    };
    const names = afterBody.offlineAuthUsers.map((user) => user.username);
    expect(names).toContain(cashier.username);
    // The offline session is rebuilt from these rights: the cashier's own, at least the till.
    const cashierEntry = afterBody.offlineAuthUsers.find(
      (user) => user.username === cashier.username
    );
    expect(cashierEntry?.permissions).toContain("pos.use");
    // Only cashiers: no administrator of the shop, no platform administrator.
    for (const user of afterBody.offlineAuthUsers) expect(user.isSuperuser).toBe(false);
    const admins = await db
      .select({ username: users.username })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.companyId, context.company.id), eq(roles.slug, "administrateur")));
    for (const admin of admins) expect(names).not.toContain(admin.username);
  });

  it("does not let a cashier sell a catalog item at another price", async () => {
    const product = await createStockedProduct(context, { salePriceCents: 10_000 });
    const cashier = await createMember(context, "vendeur");
    const token = await login(cashier.username);
    const customer = await partiesApplication.create(context.company.id, { name: "Client" });

    const response = await call("POST", "/api/invoices", token, {
      partyId: customer.id,
      lines: [{ productId: product.id, quantity: 1, unitPriceCents: 100 }],
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe("PRICE_OVERRIDE_FORBIDDEN");
  });
});

describe("money (§3.5 to §3.10, §4.10)", () => {
  async function invoice(lines: { quantity: number; priceCents: number }[], discountBp = 0) {
    const customer = await partiesApplication.create(context.company.id, { name: "Client" });
    const product = await createStockedProduct(context);
    const created = await invoicingApplication.create(
      context.company,
      {
        partyId: customer.id,
        globalDiscountBp: discountBp,
        validate: true,
        lines: lines.map((line) => ({
          productId: product.id,
          quantity: line.quantity,
          unitPriceCents: line.priceCents,
        })),
      },
      context.userId
    );
    return { invoice: created, customer, product };
  }

  it("never returns more than the invoice, and lowers what is still owed (§3.5)", async () => {
    const { invoice: sale, customer } = await invoice([{ quantity: 10, priceCents: 1_000 }]);
    const [line] = sale.lines;

    await invoicingApplication.createCreditNote(context.company, {
      invoiceId: sale.id,
      lines: [{ invoiceLineId: line.id, quantity: 6 }],
    });
    await expect(
      invoicingApplication.createCreditNote(context.company, {
        invoiceId: sale.id,
        lines: [{ invoiceLineId: line.id, quantity: 6 }],
      })
    ).rejects.toMatchObject({ code: "CREDIT_NOTE_TOO_LARGE" });

    // 10 000 invoiced, 6 000 returned: 4 000 is still owed, not 10 000.
    await expect(
      paymentsApplication.create(context.company, {
        partyId: customer.id,
        invoiceId: sale.id,
        amountCents: 10_000,
      })
    ).rejects.toMatchObject({ code: "OVERPAYMENT" });
    await paymentsApplication.create(context.company, {
      partyId: customer.id,
      invoiceId: sale.id,
      amountCents: 4_000,
    });
    const [paid] = await db.select().from(salesInvoices).where(eq(salesInvoices.id, sale.id));
    expect(paid.status).toBe("PAID");
    expect(await partiesApplication.outstandingBalanceCents(context.company.id, customer.id)).toBe(
      0
    );
  });

  it("refuses returning an item that was not sold (§3.6)", async () => {
    const { invoice: sale } = await invoice([{ quantity: 1, priceCents: 5_000 }]);
    const unsold = await createStockedProduct(context);
    await expect(
      invoicingApplication.createCreditNote(context.company, {
        invoiceId: sale.id,
        lines: [{ productId: unsold.id, quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: "CREDIT_NOTE_LINE_NOT_ON_INVOICE" });
  });

  it("keeps a paid ticket paid when one item of it is returned (§3.7)", async () => {
    const { invoice: sale, customer } = await invoice([{ quantity: 2, priceCents: 5_000 }]);
    await paymentsApplication.create(context.company, {
      partyId: customer.id,
      invoiceId: sale.id,
      amountCents: 10_000,
    });
    await invoicingApplication.createCreditNote(context.company, {
      invoiceId: sale.id,
      lines: [{ invoiceLineId: sale.lines[0].id, quantity: 1 }],
    });
    const [after] = await db.select().from(salesInvoices).where(eq(salesInvoices.id, sale.id));
    expect(after.status).toBe("PAID");
    expect(after.creditedAmountCents).toBe(5_000);
  });

  it("refuses paying a cancelled invoice (§3.8)", async () => {
    const { invoice: sale, customer } = await invoice([{ quantity: 1, priceCents: 5_000 }]);
    await invoicingApplication.createCreditNote(context.company, { invoiceId: sale.id });
    await expect(
      paymentsApplication.create(context.company, {
        partyId: customer.id,
        invoiceId: sale.id,
        amountCents: 1_000,
      })
    ).rejects.toMatchObject({ code: "INVOICE_NOT_PAYABLE" });
  });

  it("refuses negative or unreadable quantities (§3.9)", async () => {
    await expect(invoice([{ quantity: -1, priceCents: 500 }])).rejects.toThrow();
    const customer = await partiesApplication.create(context.company.id, { name: "Client" });
    await expect(
      invoicingApplication.create(context.company, {
        partyId: customer.id,
        validate: true,
        lines: [{ description: "Item", quantity: "abc", unitPriceCents: 500 }],
      })
    ).rejects.toThrow();
    await expect(
      invoicingApplication.create(context.company, {
        partyId: customer.id,
        validate: true,
        lines: [{ description: "Item", quantity: 1, unitPriceCents: -500 }],
      })
    ).rejects.toThrow();
  });

  it("refuses a payment in the name of another customer (§3.10)", async () => {
    const { invoice: sale } = await invoice([{ quantity: 1, priceCents: 5_000 }]);
    const someoneElse = await partiesApplication.create(context.company.id, { name: "B" });
    await expect(
      paymentsApplication.create(context.company, {
        partyId: someoneElse.id,
        invoiceId: sale.id,
        amountCents: 5_000,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_PARTY_MISMATCH" });
  });

  it("accepts a full return of an invoice with a global discount (§4.10)", async () => {
    const { invoice: sale } = await invoice([{ quantity: 1, priceCents: 10_000 }], 1_000);
    expect(sale.totalCents).toBe(9_000);
    const note = await invoicingApplication.createCreditNote(context.company, {
      invoiceId: sale.id,
    });
    expect(note?.totalCents).toBe(9_000);
  });
});
