/**
 * Documents on the offline-first desktop, without internet (`local-documents.ts`).
 *
 * The real server and the real client code, with the desktop's local database played
 * by its in-memory stand-in:
 *  1. documents are entered on the server — quotes, orders, invoices, a till sale,
 *     payments, a return, a purchase order, the goods received, the supplier invoice;
 *  2. the workstation runs its first synchronization;
 *  3. every list and every document, with the filters the screens use, is answered by
 *     the local database **exactly** as the server answers it;
 *  4. without internet, the screens get these answers — pages never opened included —,
 *     and what is entered meanwhile shows on them until it is sent.
 */

import "fake-indexeddb/auto";

import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { roles, userCompanies, userRoles, users } from "@shared/schema";
import { closeDatabase, db } from "../db";
import { createApp } from "../app";
import { hashPassword } from "../domains/auth/application";
import {
  createStockedProduct,
  createTestCompany,
  dropTestCompany,
  type TestContext,
} from "./helpers";

import { invoicingApi } from "@/entities/invoicing/api";
import { paymentApi } from "@/entities/payment/api";
import { purchasingApi } from "@/entities/purchasing/api";
import { salesApi } from "@/entities/sales/api";
import { probeServer } from "@/shared/api/network";
import { setAccessToken } from "@/shared/auth/token-store";
import { setApiBase } from "@/shared/desktop/desktop";
import { offlineDb } from "@/shared/offline/db";
import { answeredLocally, localDocumentAnswer } from "@/shared/offline/local/local-documents";
import {
  runLocalCycle,
  startLocalSession,
  stopLocalSession,
} from "@/shared/offline/local/local-sync";
import { FakeLocalDb } from "@/shared/offline/__tests__/fake-local-db";

// The release this workstation announces: the server refuses a desktop too old (426).
vi.hoisted(() => {
  (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = "1.0.0";
});

type Row = Record<string, unknown>;

const PASSWORD = "Test1234!";

let server: Server;
let baseUrl: string;
let context: TestContext;
let token: string;
let userId: string;
let fake: FakeLocalDb;
let online = true;

const ids: Record<string, string> = {};

async function call<T = Row>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Device-Id": "offline-documents",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** An administrator of the test company, signed in. */
async function signInAdministrator(): Promise<void> {
  const username = `off-${randomUUID().slice(0, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ username, passwordHash: await hashPassword(PASSWORD), firstName: "Offline" })
    .returning();
  userId = user.id;
  await db.insert(userCompanies).values({ userId: user.id, companyId: context.company.id });
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.slug, "administrateur"), isNull(roles.companyId)))
    .limit(1);
  await db
    .insert(userRoles)
    .values({ userId: user.id, roleId: role.id, companyId: context.company.id });
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  token = ((await response.json()) as { accessToken: string }).accessToken;
}

/** The documents of a small shop, entered online. */
async function enterDocuments(): Promise<void> {
  const product = await createStockedProduct(context, { salePriceCents: 25_000, quantity: 50 });
  const other = await createStockedProduct(context, { salePriceCents: 4_000, quantity: 80 });
  ids.product = product.id;
  const customer = await call("POST", "/api/parties", {
    name: "Boutique Aïcha",
    partyType: "CUSTOMER",
    phone: "22 11 00 01",
  });
  const secondCustomer = await call("POST", "/api/parties", {
    name: "Garage du Port",
    partyType: "CUSTOMER",
  });
  const supplier = await call("POST", "/api/parties", {
    name: "Grossiste Nouadhibou",
    partyType: "SUPPLIER",
  });
  ids.customer = String(customer.id);
  ids.supplier = String(supplier.id);

  const line = (productId: string, quantity: number, unitPriceCents: number) => ({
    productId,
    description: "Article",
    quantity,
    unitPriceCents,
  });

  const quote = await call("POST", "/api/quotes", {
    partyId: customer.id,
    lines: [line(product.id, 2, 25_000), line(other.id, 5, 4_000)],
  });
  ids.quote = String(quote.id);
  const converted = await call("POST", "/api/quotes", {
    partyId: secondCustomer.id,
    lines: [line(other.id, 3, 4_000)],
  });
  const order = await call("POST", `/api/quotes/${converted.id}/convert`);
  ids.salesOrder = String(order.id);

  const draft = await call("POST", "/api/invoices", {
    partyId: secondCustomer.id,
    lines: [line(other.id, 1, 4_000)],
  });
  ids.draft = String(draft.id);
  const invoice = await call("POST", "/api/invoices", {
    partyId: customer.id,
    lines: [line(product.id, 1, 25_000), line(other.id, 4, 4_000)],
    validate: true,
  });
  ids.invoice = String(invoice.id);
  const invoiceLines = invoice.lines as Row[];
  await call("POST", "/api/payments", {
    partyId: customer.id,
    invoiceId: invoice.id,
    amountCents: 10_000,
    paymentMethod: "MOBILE_MONEY",
    reference: "BANKILY-771",
  });
  const creditNote = await call("POST", "/api/credit-notes", {
    invoiceId: invoice.id,
    reason: "Carton abîmé",
    lines: [{ invoiceLineId: invoiceLines[1].id, quantity: 1 }],
  });
  ids.creditNote = String(creditNote.id);

  // A till sale, without a customer: the server gives it the walk-in customer.
  const session = await call("POST", "/api/pos/sessions", {
    registerId: context.registerId,
    openingBalanceCents: 5_000,
  });
  const ticket = await call<{ invoice: Row }>("POST", "/api/pos/tickets", {
    sessionId: session.id,
    lines: [line(other.id, 2, 4_000)],
    payments: [{ method: "CASH", amountCents: 8_000 }],
  });
  ids.ticket = String(ticket.invoice.id);

  const purchase = await call("POST", "/api/purchase-orders", {
    supplierId: supplier.id,
    lines: [line(product.id, 10, 15_000)],
  });
  ids.purchaseOrder = String(purchase.id);
  await call("PATCH", `/api/purchase-orders/${purchase.id}/status`, { status: "ORDERED" });
  const receipt = await call("POST", "/api/goods-receipts", {
    purchaseOrderId: purchase.id,
    lines: [
      {
        purchaseOrderLineId: (purchase.lines as Row[])[0].id,
        productId: product.id,
        quantity: 6,
      },
    ],
  });
  ids.receipt = String(receipt.id);
  const supplierInvoice = await call("POST", "/api/supplier-invoices", {
    supplierId: supplier.id,
    supplierReference: "GN-2026-118",
    purchaseOrderId: purchase.id,
    receiptId: receipt.id,
    lines: [line(product.id, 6, 15_000)],
  });
  ids.supplierInvoice = String(supplierInvoice.id);
}

beforeAll(async () => {
  const app = await createApp();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context = await createTestCompany("offline-docs");
  await signInAdministrator();
  await enterDocuments();

  // The desktop workstation: its local database, the server, the signed-in person.
  fake = new FakeLocalDb();
  const memory = new Map<string, string>();
  memory.set(
    "erp.session.cache",
    JSON.stringify({ user: { id: userId }, company: { id: context.company.id } })
  );
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
  vi.stubGlobal("navigator", {
    get onLine() {
      return online;
    },
  });
  setApiBase(baseUrl);
  setAccessToken(token);
  await offlineDb.open();
  await startLocalSession(context.company.id);
  // First synchronization: every document downloaded into the local database.
  await runLocalCycle();
});

afterAll(async () => {
  await stopLocalSession().catch(() => undefined);
  vi.unstubAllGlobals();
  server.close();
  await dropTestCompany(context);
  await db.delete(users).where(eq(users.id, userId));
  await closeDatabase();
});

/** Every list and document the screens ask for, with their usual filters. */
function paths(): string[] {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "/api/invoices?limit=25&offset=0",
    "/api/invoices?limit=2&offset=1",
    "/api/invoices",
    "/api/invoices?search=a%C3%AFcha",
    "/api/invoices?search=FAC",
    "/api/invoices?status=VALIDATED",
    "/api/invoices?status=DRAFT",
    "/api/invoices?unpaidOnly=true",
    "/api/invoices?source=POS",
    `/api/invoices?partyId=${ids.customer}`,
    `/api/invoices?fromDate=${today}&toDate=${today}`,
    "/api/invoices?fromDate=2000-01-01&toDate=2000-12-31",
    `/api/invoices/${ids.invoice}`,
    `/api/invoices/${ids.draft}`,
    `/api/invoices/${ids.ticket}`,
    "/api/credit-notes?limit=25&offset=0",
    `/api/credit-notes?invoiceId=${ids.invoice}`,
    `/api/credit-notes/${ids.creditNote}`,
    "/api/quotes?limit=25&offset=0",
    "/api/quotes?status=DRAFT",
    "/api/quotes?search=garage",
    `/api/quotes?partyId=${ids.customer}`,
    `/api/quotes/${ids.quote}`,
    "/api/sales-orders?limit=25&offset=0",
    `/api/sales-orders/${ids.salesOrder}`,
    "/api/payments?limit=25&offset=0",
    `/api/payments?invoiceId=${ids.invoice}`,
    "/api/payments?method=CASH",
    "/api/payments?method=MOBILE_MONEY",
    "/api/payments?direction=IN",
    `/api/payments?partyId=${ids.customer}`,
    "/api/purchase-orders?limit=25&offset=0",
    "/api/purchase-orders?search=nouadhibou",
    "/api/purchase-orders?status=PARTIALLY_RECEIVED",
    `/api/purchase-orders/${ids.purchaseOrder}`,
    "/api/goods-receipts",
    `/api/goods-receipts?purchaseOrderId=${ids.purchaseOrder}`,
    `/api/goods-receipts/${ids.receipt}`,
    "/api/supplier-invoices?limit=25&offset=0",
    `/api/supplier-invoices?supplierId=${ids.supplier}`,
    `/api/supplier-invoices/${ids.supplierInvoice}`,
  ];
}

describe("documents answered by the local database", () => {
  it("are all downloaded by the first synchronization", () => {
    for (const path of paths()) expect(answeredLocally(path), path).toBe(true);
  });

  it("answer exactly as the server does", async () => {
    const sizes: Record<string, number> = {};
    for (const path of paths()) {
      const expected = await call<Row | Row[]>("GET", path);
      expect(await localDocumentAnswer(path), path).toEqual(expected);
      sizes[path] = Array.isArray(expected)
        ? expected.length
        : Array.isArray(expected.items)
          ? expected.items.length
          : 1;
    }
    // The comparisons are made on real content, not on empty lists.
    expect(sizes["/api/invoices?limit=25&offset=0"]).toBe(3);
    expect(sizes["/api/invoices?limit=2&offset=1"]).toBe(2);
    expect(sizes["/api/invoices?search=a%C3%AFcha"]).toBe(1);
    expect(sizes["/api/invoices?unpaidOnly=true"]).toBe(1);
    expect(sizes["/api/quotes?limit=25&offset=0"]).toBe(2);
    expect(sizes["/api/quotes?search=garage"]).toBe(1);
    expect(sizes["/api/payments?limit=25&offset=0"]).toBe(2);
    expect(sizes["/api/payments?method=CASH"]).toBe(1);
    expect(sizes["/api/purchase-orders?search=nouadhibou"]).toBe(1);
    expect(sizes["/api/goods-receipts"]).toBe(1);
    expect(sizes["/api/supplier-invoices?limit=25&offset=0"]).toBe(1);
    expect(sizes["/api/invoices?fromDate=2000-01-01&toDate=2000-12-31"]).toBe(0);
  });

  it("are shown without internet, pages never opened included", async () => {
    const invoices = await call("GET", "/api/invoices?limit=25&offset=0");
    const detail = await call("GET", `/api/purchase-orders/${ids.purchaseOrder}`);
    online = false;
    try {
      expect(await invoicingApi.list({ limit: 25, offset: 0 })).toEqual(invoices);
      expect(await purchasingApi.getOrder(ids.purchaseOrder)).toEqual(detail);
      const payments = await paymentApi.list({ invoiceId: ids.invoice });
      expect(payments.items.map((payment) => payment.reference)).toEqual(["BANKILY-771"]);
    } finally {
      online = true;
    }
  });

  it("show what is entered without internet until it is sent", async () => {
    online = false;
    try {
      // A change of status and a new purchase order, queued for later.
      await salesApi.setQuoteStatus(ids.quote, "SENT");
      const created = (await purchasingApi.createOrder({
        supplierId: ids.supplier,
        lines: [{ productId: ids.product, description: "Riz", quantity: 3, unitPriceCents: 900 }],
      })) as unknown as Row;

      expect((await salesApi.getQuote(ids.quote)).status).toBe("SENT");
      const quotes = await salesApi.listQuotes({ limit: 25, offset: 0 });
      expect(quotes.items.find((quote) => quote.id === ids.quote)?.status).toBe("SENT");

      const orders = await purchasingApi.listOrders({ limit: 25, offset: 0 });
      expect(orders.items[0].id).toBe(created.id);
      expect(orders.items).toHaveLength(2);
      expect(orders.total).toBe(2);
      // Not on the next page, nor in a list it does not belong to.
      expect((await purchasingApi.listOrders({ limit: 25, offset: 25 })).items).toHaveLength(0);
      const received = await purchasingApi.listOrders({ status: "PARTIALLY_RECEIVED" });
      expect(received.items.map((order) => order.id)).toEqual([ids.purchaseOrder]);

      // A draft cancelled: gone from the list and from its page.
      await invoicingApi.cancelDraft(ids.draft);
      const invoices = await invoicingApi.list({ limit: 25, offset: 0 });
      expect(invoices.items.map((invoice) => invoice.id)).not.toContain(ids.draft);
      expect(invoices.total).toBe(2);
      await expect(invoicingApi.get(ids.draft)).rejects.toMatchObject({ isNetworkError: true });
    } finally {
      online = true;
    }

    // Internet back: sent, then read back from the server like any other document.
    await probeServer(true);
    await runLocalCycle();
    const quote = await call("GET", `/api/quotes/${ids.quote}`);
    expect(quote.status).toBe("SENT");
    expect(await localDocumentAnswer(`/api/quotes/${ids.quote}`)).toEqual(quote);
    const orders = await call("GET", "/api/purchase-orders?limit=25&offset=0");
    expect((orders.items as Row[]).length).toBe(2);
    expect(await localDocumentAnswer("/api/purchase-orders?limit=25&offset=0")).toEqual(orders);
    // The server keeps a cancelled draft, as cancelled.
    const draft = await call("GET", `/api/invoices/${ids.draft}`);
    expect(draft.status).toBe("CANCELLED");
    expect(await localDocumentAnswer(`/api/invoices/${ids.draft}`)).toEqual(draft);
    const invoices = await call("GET", "/api/invoices?limit=25&offset=0");
    expect(await localDocumentAnswer("/api/invoices?limit=25&offset=0")).toEqual(invoices);
  });
});
