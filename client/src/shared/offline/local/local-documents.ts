/**
 * Documents of the offline-first desktop — quotes, sales orders, invoices, returns,
 * payments, purchase orders, goods received, supplier invoices — answered from the
 * company's local database when the server cannot answer (`docs/OFFLINE_SYNC.md`).
 *
 * Their screens ask the server first: documents are written on the server, and the
 * next pull brings them here, so right after a change only the server is up to date.
 * When the server does not answer — no internet, or too slow — `offline-copy.ts` asks
 * here. The local database holds every document of the first synchronization (the last
 * 12 months, plus everything still open) and every change since: pages never opened are
 * there too, nothing has to be downloaded page after page beforehand.
 *
 * Each answer is **the one of the server route** — same shape, filters, search, order
 * and page —, the server rules being quoted from the repositories they mirror: change
 * both together (`server/__tests__/offline-documents.test.ts` compares them on the same
 * data). Writes queued without internet and not sent yet (`offline-http.ts`) are shown
 * on top, the way the device's copy of the answers shows them.
 *
 * `undefined` — never an error — when the local database cannot answer: its data is not
 * complete, the document is not in it, or the database is closed.
 */

import type { SyncTable } from "@shared/sync-protocol";
import { HTTP_REQUEST_ENTITY, offlineDb, type OutboxStatus } from "../db";
import { readCachedResponse } from "../http-cache";
import { createdCollection, isRow, parseWritePath, reflectedPatch } from "../write-paths";
import { localCompanyId, localDb, type QuerySpec } from "./local-db";
import { isLocalReady } from "./replication";

type Row = Record<string, unknown>;
type Filter = NonNullable<QuerySpec["filters"]>[number];

/** Server page when none is asked, and the largest one it accepts (list schemas). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Customer the server gives a sale made without one (`parties/application.ts`). */
const WALK_IN_CODE = "CLI-COMPTOIR";
/** Order of the server lists: newest first, then last entered first. */
const NEWEST_FIRST: QuerySpec["orderBy"] = [
  { column: "date", desc: true },
  { column: "json:createdAt", desc: true },
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Reading the local database ──────────────────────────────────────────────

interface Page {
  limit: number;
  offset: number;
}

/** `limit` and `offset` as the list schemas read them. */
function pageOf(params: URLSearchParams): Page {
  const limit = Number(params.get("limit"));
  const offset = Number(params.get("offset"));
  return {
    limit:
      params.has("limit") && Number.isInteger(limit) && limit >= 1
        ? Math.min(limit, MAX_LIMIT)
        : DEFAULT_LIMIT,
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

function param(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim();
  return value ? value : null;
}

/** Equality filters of the query parameters present. */
function equalities(params: URLSearchParams, columns: Record<string, string>): Filter[] {
  return Object.entries(columns).flatMap(([key, column]) => {
    const value = param(params, key);
    return value ? [{ column, op: "eq" as const, value }] : [];
  });
}

/** `fromDate` and `toDate`, on the date of the document. */
function period(params: URLSearchParams): Filter[] {
  const from = param(params, "fromDate");
  const to = param(params, "toDate");
  return [
    ...(from ? [{ column: "date", op: "gte" as const, value: from }] : []),
    ...(to ? [{ column: "date", op: "lte" as const, value: to }] : []),
  ];
}

async function query(spec: QuerySpec): Promise<{ rows: Row[]; total: number }> {
  const result = await localDb.query<Row>(spec);
  return { rows: result.rows.map((row) => row.data), total: result.total };
}

/** A document, unless deleted here. */
async function one(entity: SyncTable, id: string): Promise<Row | null> {
  const [row] = await localDb.get<Row>(entity, [id]);
  return row && !row.deletedAt ? row.data : null;
}

/** Rows by id — archived ones included, as the server joins them. */
async function byId(entity: SyncTable, ids: unknown[]): Promise<Map<string, Row>> {
  const wanted = [
    ...new Set(ids.filter((id): id is string => typeof id === "string" && id !== "")),
  ];
  if (wanted.length === 0) return new Map();
  const rows = await localDb.get<Row>(entity, wanted);
  return new Map(rows.map((row) => [row.id, row.data]));
}

/**
 * Customer or supplier of each document. A sale made here without a customer has none
 * yet: the server gives it the walk-in customer, shown here already.
 */
async function partiesOf(ids: unknown[]): Promise<(id: unknown) => Row | null> {
  const parties = await byId("parties", ids);
  let walkIn: Row | null = null;
  if (ids.some((id) => id == null)) {
    const { rows } = await query({
      entity: "parties",
      filters: [{ column: "code", op: "eq", value: WALK_IN_CODE }],
      limit: 1,
      includeDeleted: true,
    });
    walkIn = rows[0] ?? null;
  }
  return (id) => (typeof id === "string" ? (parties.get(id) ?? null) : walkIn);
}

const nameOf = (party: Row | null) => String(party?.name ?? "");

/**
 * The search of the document lists: `number ilike %term% or <party>.name ilike %term%`.
 * The customers or suppliers named so are found first, archived ones included.
 */
async function numberOrPartyNamed(params: URLSearchParams): Promise<QuerySpec["search"]> {
  const term = param(params, "search");
  if (!term) return null;
  const { rows } = await localDb.query({
    entity: "parties",
    search: { term, columns: ["name"] },
    includeDeleted: true,
  });
  return {
    term,
    columns: ["number"],
    anyOf: [{ column: "party_id", values: rows.map((row) => row.id) }],
  };
}

/** A list row: the document without its lines, which the server lists never carry. */
function listed(row: Row): Row {
  const { lines: _lines, ...document } = row;
  return document;
}

/** Lines in their order on the document, as the server sorts them (`position`). */
function inOrder(lines: unknown): Row[] {
  const rows = Array.isArray(lines) ? lines.filter(isRow) : [];
  return [...rows].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
}

interface ListAnswer {
  items: Row[];
  total: number;
}

// ─── Customer invoicing (`invoicing/repository.ts`) ──────────────────────────

/** `GET /api/invoices`: `list`, newest first, with the customer's name and code. */
async function listInvoices(params: URLSearchParams): Promise<ListAnswer> {
  const { limit, offset } = pageOf(params);
  const unpaidOnly = params.get("unpaidOnly") === "true";
  const spec: QuerySpec = {
    entity: "sales_invoices",
    filters: [
      ...equalities(params, {
        status: "status",
        partyId: "party_id",
        source: "json:source",
        posSessionId: "pos_session_id",
      }),
      ...period(params),
      ...(unpaidOnly
        ? [{ column: "status", op: "in" as const, value: ["VALIDATED", "PARTIALLY_PAID"] }]
        : []),
    ],
    search: await numberOrPartyNamed(params),
    orderBy: NEWEST_FIRST,
  };
  let found: { rows: Row[]; total: number };
  if (unpaidOnly) {
    // `total_cents > paid_amount_cents` compares two fields of a row: done here.
    const all = await query(spec);
    const unpaid = all.rows.filter((row) => Number(row.totalCents) > Number(row.paidAmountCents));
    found = { rows: unpaid.slice(offset, offset + limit), total: unpaid.length };
  } else {
    found = await query({ ...spec, limit, offset });
  }
  const party = await partiesOf(found.rows.map((row) => row.partyId));
  return {
    items: found.rows.map((row) => ({
      ...listed(row),
      partyName: nameOf(party(row.partyId)),
      partyCode: String(party(row.partyId)?.code ?? ""),
    })),
    total: found.total,
  };
}

/** `GET /api/invoices/:id`: `findById`, lines in order. */
async function invoiceDetail(id: string): Promise<Row | null> {
  const invoice = await one("sales_invoices", id);
  if (!invoice) return null;
  const party = (await partiesOf([invoice.partyId]))(invoice.partyId);
  return {
    ...invoice,
    lines: inOrder(invoice.lines),
    partyName: nameOf(party),
    partyCode: String(party?.code ?? ""),
  };
}

/** `GET /api/credit-notes`: `listCreditNotes`, newest first, with the customer's name. */
async function listCreditNotes(params: URLSearchParams): Promise<ListAnswer> {
  const found = await query({
    entity: "credit_notes",
    filters: equalities(params, { invoiceId: "invoice_id" }),
    orderBy: [{ column: "date", desc: true }],
    ...pageOf(params),
  });
  const party = await partiesOf(found.rows.map((row) => row.partyId));
  return {
    items: found.rows.map((row) => ({ ...listed(row), partyName: nameOf(party(row.partyId)) })),
    total: found.total,
  };
}

/** `GET /api/credit-notes/:id`: `findCreditNote`, with the number of its invoice. */
async function creditNoteDetail(id: string): Promise<Row | null> {
  const note = await one("credit_notes", id);
  if (!note) return null;
  const party = (await partiesOf([note.partyId]))(note.partyId);
  const invoice = (await byId("sales_invoices", [note.invoiceId])).get(String(note.invoiceId));
  return {
    ...note,
    partyName: nameOf(party),
    invoiceNumber: (invoice?.number as string | undefined) ?? null,
    lines: inOrder(note.lines),
  };
}

// ─── Quotes and sales orders (`sales/repository.ts`) ─────────────────────────

/** `listQuotes` and `listOrders`: the same list over two tables. */
async function listSalesDocuments(
  entity: "quotes" | "sales_orders",
  params: URLSearchParams
): Promise<ListAnswer> {
  const found = await query({
    entity,
    filters: [...equalities(params, { status: "status", partyId: "party_id" }), ...period(params)],
    search: await numberOrPartyNamed(params),
    orderBy: NEWEST_FIRST,
    ...pageOf(params),
  });
  const party = await partiesOf(found.rows.map((row) => row.partyId));
  return {
    items: found.rows.map((row) => ({ ...listed(row), partyName: nameOf(party(row.partyId)) })),
    total: found.total,
  };
}

/** `findQuote` and `findOrder`: lines in order, with the customer's name. */
async function salesDocumentDetail(
  entity: "quotes" | "sales_orders",
  id: string
): Promise<Row | null> {
  const document = await one(entity, id);
  if (!document) return null;
  const party = (await partiesOf([document.partyId]))(document.partyId);
  return { ...document, lines: inOrder(document.lines), partyName: nameOf(party) };
}

// ─── Payments (`payments/repository.ts`) ─────────────────────────────────────

/**
 * `GET /api/payments`: `list`, newest first, with the names of the party, the invoice,
 * the supplier invoice and the account. Only two ways to pay are offered: cash, or a
 * banking app (every other method).
 */
async function listPayments(params: URLSearchParams): Promise<ListAnswer> {
  const method = param(params, "method");
  const found = await query({
    entity: "payments",
    filters: [
      ...equalities(params, {
        partyId: "party_id",
        invoiceId: "invoice_id",
        direction: "json:direction",
        posSessionId: "pos_session_id",
      }),
      ...(method
        ? [
            {
              column: "json:paymentMethod",
              op: method === "CASH" ? ("eq" as const) : ("ne" as const),
              value: "CASH",
            },
          ]
        : []),
      ...period(params),
    ],
    orderBy: NEWEST_FIRST,
    ...pageOf(params),
  });
  const party = await partiesOf(found.rows.map((row) => row.partyId));
  const invoices = await byId(
    "sales_invoices",
    found.rows.map((row) => row.invoiceId)
  );
  // Payments to suppliers: named when this person also receives the purchases.
  const supplierInvoices = isLocalReady("supplier_invoices")
    ? await byId(
        "supplier_invoices",
        found.rows.map((row) => row.supplierInvoiceId)
      )
    : new Map<string, Row>();
  const accounts = await byId(
    "bank_accounts",
    found.rows.map((row) => row.bankAccountId)
  );
  const field = (rows: Map<string, Row>, id: unknown, key: string) =>
    (rows.get(String(id))?.[key] as string | undefined) ?? null;
  return {
    items: found.rows.map((row) => ({
      ...row,
      partyName: nameOf(party(row.partyId)),
      invoiceNumber: field(invoices, row.invoiceId, "number"),
      supplierInvoiceNumber: field(supplierInvoices, row.supplierInvoiceId, "number"),
      bankAccountName: field(accounts, row.bankAccountId, "name"),
    })),
    total: found.total,
  };
}

// ─── Purchasing (`purchasing/repository.ts`) ─────────────────────────────────

/** `GET /api/purchase-orders`: `listOrders`, newest first, with the supplier's name. */
async function listPurchaseOrders(params: URLSearchParams): Promise<ListAnswer> {
  const found = await query({
    entity: "purchase_orders",
    filters: [
      ...equalities(params, { status: "status", supplierId: "party_id" }),
      ...period(params),
    ],
    search: await numberOrPartyNamed(params),
    orderBy: NEWEST_FIRST,
    ...pageOf(params),
  });
  const supplier = await partiesOf(found.rows.map((row) => row.supplierId));
  return {
    items: found.rows.map((row) => ({
      ...listed(row),
      supplierName: nameOf(supplier(row.supplierId)),
    })),
    total: found.total,
  };
}

/** `GET /api/purchase-orders/:id`: `findOrder`, lines in order. */
async function purchaseOrderDetail(id: string): Promise<Row | null> {
  const order = await one("purchase_orders", id);
  if (!order) return null;
  const supplier = (await partiesOf([order.supplierId]))(order.supplierId);
  return { ...order, lines: inOrder(order.lines), supplierName: nameOf(supplier) };
}

/**
 * `GET /api/goods-receipts`: `listReceipts` — a plain list, newest first, of 50 at most
 * (the route passes no page), with the supplier's name.
 */
async function listGoodsReceipts(params: URLSearchParams): Promise<Row[]> {
  const found = await query({
    entity: "goods_receipts",
    filters: equalities(params, { purchaseOrderId: "json:purchaseOrderId" }),
    orderBy: [{ column: "date", desc: true }],
    limit: DEFAULT_LIMIT,
  });
  const supplier = await partiesOf(found.rows.map((row) => row.supplierId));
  return found.rows.map((row) => ({
    ...listed(row),
    supplierName: nameOf(supplier(row.supplierId)),
  }));
}

/** `GET /api/goods-receipts/:id`: `findReceipt`, each line with its product. */
async function goodsReceiptDetail(id: string): Promise<Row | null> {
  const receipt = await one("goods_receipts", id);
  if (!receipt) return null;
  const lines = Array.isArray(receipt.lines) ? receipt.lines.filter(isRow) : [];
  const products = await byId(
    "products",
    lines.map((line) => line.productId)
  );
  const supplier = (await partiesOf([receipt.supplierId]))(receipt.supplierId);
  const order = (await byId("purchase_orders", [receipt.purchaseOrderId])).get(
    String(receipt.purchaseOrderId)
  );
  return {
    ...receipt,
    lines: lines.map((line) => {
      const product = products.get(String(line.productId));
      return {
        ...line,
        productName: String(product?.name ?? ""),
        productSku: String(product?.sku ?? ""),
      };
    }),
    supplierName: nameOf(supplier),
    purchaseOrderNumber: (order?.number as string | undefined) ?? null,
  };
}

/** `GET /api/supplier-invoices`: `listSupplierInvoices`, newest first. */
async function listSupplierInvoices(params: URLSearchParams): Promise<ListAnswer> {
  const found = await query({
    entity: "supplier_invoices",
    filters: equalities(params, { supplierId: "party_id", status: "status" }),
    orderBy: [{ column: "date", desc: true }],
    ...pageOf(params),
  });
  const supplier = await partiesOf(found.rows.map((row) => row.supplierId));
  return {
    items: found.rows.map((row) => ({
      ...listed(row),
      supplierName: nameOf(supplier(row.supplierId)),
    })),
    total: found.total,
  };
}

/** `GET /api/supplier-invoices/:id`: `findSupplierInvoiceDetail`. */
async function supplierInvoiceDetail(id: string): Promise<Row | null> {
  const invoice = await one("supplier_invoices", id);
  if (!invoice) return null;
  const supplier = (await partiesOf([invoice.supplierId]))(invoice.supplierId);
  const order = (await byId("purchase_orders", [invoice.purchaseOrderId])).get(
    String(invoice.purchaseOrderId)
  );
  const receipt = (await byId("goods_receipts", [invoice.receiptId])).get(
    String(invoice.receiptId)
  );
  return {
    ...invoice,
    lines: inOrder(invoice.lines),
    supplierName: nameOf(supplier),
    purchaseOrderNumber: (order?.number as string | undefined) ?? null,
    receiptNumber: (receipt?.number as string | undefined) ?? null,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

interface DocumentRoute {
  path: string;
  /** Everything an answer needs: the local database answers once all are complete. */
  entities: SyncTable[];
  list: (params: URLSearchParams) => Promise<ListAnswer | Row[]>;
  detail?: (id: string) => Promise<Row | null>;
}

const ROUTES: DocumentRoute[] = [
  {
    path: "/api/invoices",
    entities: ["sales_invoices", "parties"],
    list: listInvoices,
    detail: invoiceDetail,
  },
  {
    path: "/api/credit-notes",
    entities: ["credit_notes", "sales_invoices", "parties"],
    list: listCreditNotes,
    detail: creditNoteDetail,
  },
  {
    path: "/api/quotes",
    entities: ["quotes", "parties"],
    list: (params) => listSalesDocuments("quotes", params),
    detail: (id) => salesDocumentDetail("quotes", id),
  },
  {
    path: "/api/sales-orders",
    entities: ["sales_orders", "parties"],
    list: (params) => listSalesDocuments("sales_orders", params),
    detail: (id) => salesDocumentDetail("sales_orders", id),
  },
  {
    path: "/api/payments",
    entities: ["payments", "sales_invoices", "bank_accounts", "parties"],
    list: listPayments,
  },
  {
    path: "/api/purchase-orders",
    entities: ["purchase_orders", "parties"],
    list: listPurchaseOrders,
    detail: purchaseOrderDetail,
  },
  {
    path: "/api/goods-receipts",
    entities: ["goods_receipts", "purchase_orders", "products", "parties"],
    list: listGoodsReceipts,
    detail: goodsReceiptDetail,
  },
  {
    path: "/api/supplier-invoices",
    entities: ["supplier_invoices", "purchase_orders", "goods_receipts", "parties"],
    list: listSupplierInvoices,
    detail: supplierInvoiceDetail,
  },
];

function routeOf(pathname: string): { route: DocumentRoute; id: string | null } | null {
  for (const route of ROUTES) {
    if (pathname === route.path) return { route, id: null };
    const id = pathname.startsWith(`${route.path}/`) ? pathname.slice(route.path.length + 1) : "";
    if (id && UUID_PATTERN.test(id)) return route.detail ? { route, id } : null;
  }
  return null;
}

/**
 * True when the local database answers this path (a list or a document) on this
 * workstation: the preparation of the device then has nothing to download for it.
 */
export function answeredLocally(path: string): boolean {
  if (!localCompanyId()) return false;
  const match = routeOf(new URL(path, "http://local").pathname);
  return !!match && match.route.entities.every(isLocalReady);
}

// ─── Writes waiting to be sent ───────────────────────────────────────────────

interface PendingWrite {
  /** Id of the queued operation: also the id of what it creates. */
  id: string;
  method: string;
  collection: string;
  itemId: string | null;
  action: string;
  body: Row;
  at: string;
  /** Collection it creates an item in, if any. */
  creates: string | null;
}

const WAITING = new Set<OutboxStatus>(["pending", "sending", "deferred"]);

/**
 * Writes queued without internet (`offline-http.ts`) the server has not taken yet — read
 * from the copy of the queue kept for the screens, where they are found by their kind,
 * however many sales wait beside them.
 */
async function pendingWrites(): Promise<PendingWrite[]> {
  let records;
  try {
    records = await offlineDb.outbox.where("entity").equals(HTTP_REQUEST_ENTITY).toArray();
  } catch {
    // No copy of the queue: the documents are shown as the local database has them.
    return [];
  }
  return records
    .filter((record) => WAITING.has(record.status))
    .sort((a, b) => a.localSeq - b.localSeq)
    .flatMap((record) => {
      const payload = isRow(record.payload) ? record.payload : {};
      const method = String(payload.method ?? "").toUpperCase();
      const path = String(payload.url ?? "").split("?")[0];
      if (!method || !path) return [];
      return [
        {
          id: record.clientUuid,
          method,
          ...parseWritePath(path),
          body: isRow(payload.body) ? payload.body : {},
          at: record.createdAt,
          creates: createdCollection(method, path),
        },
      ];
    });
}

/** A change waiting to be sent, on a document shown: deleted (`null`) or changed. */
function withChanges(path: string, document: Row, writes: PendingWrite[]): Row | null {
  let shown = document;
  for (const write of writes) {
    if (write.collection !== path || write.itemId !== document.id || write.creates) continue;
    if (write.method === "DELETE" && !write.action) return null;
    shown = { ...shown, ...reflectedPatch(write.body, write.action, write.at) };
  }
  return shown;
}

/** Whether a document created here belongs to the list asked for. */
function belongsTo(document: Row, params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (key === "limit" || key === "offset" || !value.trim()) continue;
    if (key === "search") {
      const term = value.trim().toLowerCase();
      const names = [document.number, document.partyName, document.supplierName];
      if (!names.some((name) => typeof name === "string" && name.toLowerCase().includes(term)))
        return false;
    } else if (key === "fromDate" || key === "toDate") {
      const date = String(document.date ?? "").slice(0, 10);
      if (date && (key === "fromDate" ? date < value : date > value)) return false;
    } else if (key === "unpaidOnly") {
      if (value === "true" && !["VALIDATED", "PARTIALLY_PAID"].includes(String(document.status)))
        return false;
    } else if (key in document && String(document[key] ?? "") !== value) {
      return false;
    }
  }
  return true;
}

/**
 * A list with the writes waiting to be sent: changes and deletions on its rows, and on
 * the first page the documents created here — the copy stored when they were entered
 * (`offline-http.ts`), newest first.
 */
async function listWithWrites(
  path: string,
  answer: ListAnswer,
  writes: PendingWrite[],
  params: URLSearchParams
): Promise<ListAnswer> {
  let { items, total } = answer;
  items = items.flatMap((row) => {
    const shown = withChanges(path, row, writes);
    if (!shown) total -= 1;
    return shown ? [shown] : [];
  });
  if (pageOf(params).offset > 0) return { items, total };
  for (const write of writes) {
    if (write.creates !== path || items.some((row) => row.id === write.id)) continue;
    const created = await readCachedResponse(`${path}/${write.id}`);
    if (!isRow(created) || !belongsTo(created, params)) continue;
    items = [listed(created), ...items];
    total += 1;
  }
  return { items, total };
}

/**
 * Answer of the local database for a document path, with the writes waiting to be sent;
 * `undefined` when it cannot answer.
 */
export async function localDocumentAnswer(url: string): Promise<unknown> {
  if (!localCompanyId()) return undefined;
  const parsed = new URL(url, "http://local");
  const match = routeOf(parsed.pathname);
  if (!match || !match.route.entities.every(isLocalReady)) return undefined;
  const { route, id } = match;
  try {
    const writes = await pendingWrites();
    if (id) {
      const document = await route.detail!(id);
      return (document && withChanges(route.path, document, writes)) ?? undefined;
    }
    const answer = await route.list(parsed.searchParams);
    if (Array.isArray(answer)) {
      const shown = await listWithWrites(
        route.path,
        { items: answer, total: answer.length },
        writes,
        parsed.searchParams
      );
      return shown.items;
    }
    return await listWithWrites(route.path, answer, writes, parsed.searchParams);
  } catch (error) {
    // Database closed meanwhile (company switch, sign-out): the device's copy answers.
    console.warn("[local-db] local answer failed", error);
    return undefined;
  }
}
