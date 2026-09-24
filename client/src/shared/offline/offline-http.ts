/**
 * **Generic** queue of offline writes.
 *
 * Sales, invoices, quotes, parties, products, payments and stock movements have their
 * own dedicated synchronization operation (`offline-writes.ts`). Every other write —
 * categories, warehouses, purchase orders, treasury, accounting, settings, roles,
 * users, modules… — goes through here: if the server is unreachable, `http.ts` queues
 * the request instead of failing, and the synchronization engine replays it as is when
 * the network returns.
 *
 * Guarantees:
 *  - **no duplicate**: the request carries an `Idempotency-Key` from the very first
 *    send, reused on replay; the server returns the response it already produced
 *    instead of writing again (`server/middleware/idempotency.ts`);
 *  - **causal order**: replay in entry order (`localSeq`), interleaved with the
 *    dedicated operations;
 *  - **local references**: an item created offline gets a provisional identifier
 *    (the request key); later writes that reference it are rewritten with the server
 *    identifier at replay time;
 *  - **immediate display**: the write is reflected in the read cache, so that the list
 *    or the detail page shows right away what was just entered.
 */

import { toast } from "sonner";

import { computeDocumentTotals } from "@shared/pricing";

import { i18n } from "@/shared/i18n";

import { HTTP_REQUEST_ENTITY, type OutboxRecord } from "./db";
import {
  cachedRowsOf,
  readCachedResponse,
  storeCachedResponse,
  updateCachedResponses,
} from "./http-cache";
import { enqueue } from "./outbox";
import { readSnapshot, writeSnapshot, type OfflineSnapshot } from "./snapshot";
import { refreshCounters } from "./sync-engine";

export type HttpWriteMethod = "POST" | "PATCH" | "PUT" | "DELETE";

export interface HttpWritePayload {
  method: HttpWriteMethod;
  /** Path and parameters, as sent on the first attempt. */
  url: string;
  body?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Writes **not** queued by this module:
 *  - authentication and synchronization — meaningless offline;
 *  - those that have a dedicated synchronization operation, handled by their screen
 *    (`onlineOrQueued`, POS): they must receive the network error to switch to their
 *    own queue (provisional number, stock, accounting).
 */
const NOT_QUEUED: { method: HttpWriteMethod | "*"; pattern: RegExp }[] = [
  { method: "*", pattern: /^\/api\/auth(\/|$)/ },
  { method: "*", pattern: /^\/api\/sync(\/|$)/ },
  { method: "POST", pattern: /^\/api\/parties$/ },
  { method: "POST", pattern: /^\/api\/catalog\/products$/ },
  { method: "POST", pattern: /^\/api\/quotes$/ },
  { method: "POST", pattern: /^\/api\/invoices$/ },
  { method: "POST", pattern: /^\/api\/payments$/ },
  { method: "POST", pattern: /^\/api\/inventory\/movements$/ },
  { method: "POST", pattern: /^\/api\/pos\/tickets$/ },
  { method: "POST", pattern: /^\/api\/pos\/sessions$/ },
  { method: "POST", pattern: /^\/api\/pos\/sessions\/[^/]+\/close$/ },
];

function pathOf(url: string): string {
  return url.split("?")[0];
}

/** True if this write must go to the generic queue when the network is missing. */
export function isQueueableWrite(method: string, url: string): boolean {
  const path = pathOf(url);
  if (!path.startsWith("/api/")) return false;
  return !NOT_QUEUED.some(
    (rule) => (rule.method === "*" || rule.method === method) && rule.pattern.test(path)
  );
}

// ─── Labels ───────────────────────────────────────────────────────────────────

/** Resource of a path → key in `offline:resources`. */
const RESOURCE_LABEL_KEYS: [RegExp, string][] = [
  [/^\/api\/users/, "user"],
  [/^\/api\/roles/, "role"],
  [/^\/api\/company\/settings/, "setting"],
  [/^\/api\/company/, "company"],
  [/^\/api\/platform\/modules/, "module"],
  [/^\/api\/catalog\/categories/, "category"],
  [/^\/api\/catalog\/products/, "product"],
  [/^\/api\/services/, "service"],
  [/^\/api\/parties/, "party"],
  [/^\/api\/warehouses/, "warehouse"],
  [/^\/api\/inventory/, "stock"],
  [/^\/api\/quotes/, "quote"],
  [/^\/api\/sales-orders/, "salesOrder"],
  [/^\/api\/invoices/, "invoice"],
  [/^\/api\/credit-notes/, "creditNote"],
  [/^\/api\/payments/, "payment"],
  [/^\/api\/purchase-orders/, "purchaseOrder"],
  [/^\/api\/goods-receipts/, "goodsReceipt"],
  [/^\/api\/supplier-invoices/, "supplierInvoice"],
  [/^\/api\/banking/, "treasury"],
  [/^\/api\/pos/, "pos"],
  [/^\/api\/accounting/, "accounting"],
];

/** HTTP method → key in `offline:write.actions`. */
const ACTION_LABEL_KEYS: Record<HttpWriteMethod, string> = {
  POST: "create",
  PATCH: "update",
  PUT: "update",
  DELETE: "delete",
};

/**
 * Readable label of a queued write. Stored with the outbox record, so it is produced
 * in the UI language at the time of the write.
 */
function describeWrite(method: HttpWriteMethod, path: string, body: unknown): string {
  const resourceKey = RESOURCE_LABEL_KEYS.find(([pattern]) => pattern.test(path))?.[1];
  const resource = i18n.t(`offline:resources.${resourceKey ?? "write"}`);
  const { itemId, action } = parsePath(path);
  const verb =
    itemId && action && method === "POST"
      ? i18n.t("offline:write.customAction", { action })
      : i18n.t(`offline:write.actions.${ACTION_LABEL_KEYS[method]}`);
  const record = (body ?? {}) as Record<string, unknown>;
  const name = [record.name, record.label, record.username, record.code, record.reference].find(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  );
  return name
    ? i18n.t("offline:write.labelNamed", { verb, resource, name })
    : i18n.t("offline:write.label", { verb, resource });
}

// ─── Local reflection ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function parsePath(path: string): { collection: string; itemId: string | null; action: string } {
  const segments = path.split("/");
  let index = -1;
  segments.forEach((segment, position) => {
    if (UUID_PATTERN.test(segment)) index = position;
  });
  if (index === -1) return { collection: path, itemId: null, action: "" };
  return {
    collection: segments.slice(0, index).join("/"),
    itemId: segments[index],
    action: segments.slice(index + 1).join("/"),
  };
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapRows(body: unknown, map: (rows: unknown[]) => unknown[]): unknown {
  if (Array.isArray(body)) return map(body);
  if (isRow(body) && Array.isArray(body.items)) {
    const items = map(body.items);
    const delta = items.length - body.items.length;
    const total = typeof body.total === "number" ? body.total + delta : body.total;
    return { ...body, items, total };
  }
  return body;
}

/** Collections served by the snapshot rather than by the HTTP cache. */
function snapshotRows(
  snapshot: OfflineSnapshot,
  collection: string
): { get(): Row[]; set(rows: Row[]): void } | null {
  const direct: Record<string, keyof OfflineSnapshot> = {
    "/api/catalog/categories": "categories",
    "/api/catalog/products": "products",
    "/api/parties": "parties",
    "/api/services": "services",
    "/api/warehouses": "warehouses",
    "/api/pos/registers": "registers",
  };
  const key = direct[collection];
  if (key) {
    return {
      get: () => snapshot[key] as unknown as Row[],
      set: (rows) => {
        (snapshot as unknown as Record<string, unknown>)[key] = rows;
      },
    };
  }
  return null;
}

async function reflectInSnapshot(collection: string, apply: (rows: Row[]) => Row[]) {
  const snapshot = await readSnapshot();
  if (!snapshot) return;
  const target = snapshotRows(snapshot, collection);
  if (!target) return;
  target.set(apply(target.get() ?? []));
  await writeSnapshot(snapshot);
}

/** Item currently displayed for this identifier (detail, list or snapshot). */
async function currentItem(collection: string, itemId: string): Promise<Row | null> {
  const detail = await readCachedResponse(`${collection}/${itemId}`);
  if (isRow(detail)) return detail;
  const fromList = (await cachedRowsOf(collection)).find((row) => isRow(row) && row.id === itemId);
  if (isRow(fromList)) return fromList;
  const snapshot = await readSnapshot();
  const target = snapshot ? snapshotRows(snapshot, collection) : null;
  return target?.get()?.find((row) => row.id === itemId) ?? null;
}

/** Number shown until the server assigns the legal number. */
function pendingNumber(): string {
  return i18n.t("offline:write.pendingNumber");
}

/**
 * Actions that **create** a document in another collection: a provisional document is
 * reflected there, so that the destination screen opens offline.
 */
const CREATING_ACTIONS: Record<string, string> = {
  "/api/quotes:convert": "/api/sales-orders",
  "/api/sales-orders:invoice": "/api/invoices",
};

/**
 * Provisional item as the list and the detail page would display it. For a document
 * (body with `lines`), totals are also computed and the party name is resolved, so
 * that the detail page looks like that of a server document.
 */
async function provisionalItem(body: Row, clientUuid: string, now: string): Promise<Row> {
  const item: Row = { isActive: true, createdAt: now, ...body, id: clientUuid, updatedAt: now };
  item.pendingSync = true;
  if (!Array.isArray(body.lines)) return item;

  const lines = body.lines.filter(isRow);
  const totals = computeDocumentTotals(
    lines.map((line) => ({
      quantity: line.quantity as string | number,
      unitPriceCents: Number(line.unitPriceCents ?? 0),
      discountBp: Number(line.discountBp ?? 0),
      vatRateBp: Number(line.vatRateBp ?? 0),
    })),
    { globalDiscountBp: Number(body.globalDiscountBp ?? 0), vatEnabled: true }
  );
  Object.assign(item, {
    number: body.number ?? pendingNumber(),
    status: body.status ?? "DRAFT",
    lines: lines.map((line, index) => ({
      receivedQuantity: "0",
      deliveredQuantity: "0",
      invoicedQuantity: "0",
      ...line,
      id: `${clientUuid}:${index}`,
      totalHtCents: totals.lines[index]?.totalHtCents ?? 0,
      totalVatCents: totals.lines[index]?.totalVatCents ?? 0,
      totalTtcCents: totals.lines[index]?.totalTtcCents ?? 0,
    })),
    totalHtCents: totals.totalHtCents,
    totalVatCents: totals.totalVatCents,
    totalTtcCents: totals.totalTtcCents,
    paidCents: 0,
    balanceCents: totals.totalTtcCents,
  });

  const snapshot = await readSnapshot();
  const nameOf = (id: unknown) =>
    typeof id === "string" ? snapshot?.parties.find((party) => party.id === id)?.name : undefined;
  const partyName = nameOf(body.partyId) ?? nameOf(body.customerId);
  const supplierName = nameOf(body.supplierId);
  if (partyName) Object.assign(item, { partyName: item.partyName ?? partyName });
  if (supplierName) Object.assign(item, { supplierName: item.supplierName ?? supplierName });
  return item;
}

async function reflectCreated(collection: string, created: Row, clientUuid: string) {
  await updateCachedResponses(collection, (cached) =>
    mapRows(cached, (rows) => [created, ...rows])
  );
  await storeCachedResponse(`${collection}/${clientUuid}`, created);
  await reflectInSnapshot(collection, (rows) => [created, ...rows]);
}

/**
 * Reflects the write in the local reads and returns the simulated response handed to
 * the calling screen (the created or updated item).
 */
async function reflectLocally(payload: HttpWritePayload, clientUuid: string): Promise<unknown> {
  const path = pathOf(payload.url);
  let { collection, itemId, action } = parsePath(path);
  const body = isRow(payload.body) ? payload.body : {};

  // Non-UUID identifier (code, key): only recognized if it is actually in the parent
  // list — `PUT /api/company/settings` does not target a "settings" item.
  if (!itemId && payload.method !== "POST") {
    const cut = path.lastIndexOf("/");
    const parent = path.slice(0, cut);
    const last = path.slice(cut + 1);
    if ((await cachedRowsOf(parent)).some((row) => isRow(row) && row.id === last)) {
      collection = parent;
      itemId = last;
      action = "";
    }
  }

  // Module activation: the module list reflects the new state.
  const moduleToggle = /^\/api\/platform\/modules\/([^/]+)\/(enable|disable)$/.exec(path);
  if (moduleToggle) {
    const [, code, verb] = moduleToggle;
    let modules: unknown[] = [];
    await updateCachedResponses("/api/platform/modules", (cached) => {
      if (!isRow(cached) || !Array.isArray(cached.modules)) return cached;
      modules = cached.modules.map((module) =>
        isRow(module) && module.code === code ? { ...module, isEnabled: verb === "enable" } : module
      );
      return { ...cached, modules };
    });
    return { success: true, modules };
  }
  const now = new Date().toISOString();

  // Creation: POST on a collection.
  if (payload.method === "POST" && !itemId) {
    const created = await provisionalItem(body, clientUuid, now);
    await reflectCreated(collection, created, clientUuid);
    return created;
  }

  // Turning one document into another (quote → order, order → invoice).
  const target = itemId ? CREATING_ACTIONS[`${collection}:${action}`] : undefined;
  if (payload.method === "POST" && itemId && target) {
    const source = (await currentItem(collection, itemId)) ?? {};
    const { id: _id, number: _number, status: _status, ...copied } = source;
    const created = await provisionalItem(
      { ...copied, ...body, date: now.slice(0, 10) },
      clientUuid,
      now
    );
    await reflectCreated(target, created, clientUuid);
    return created;
  }

  // Deletion.
  if (payload.method === "DELETE" && itemId && !action) {
    const keep = (row: unknown) => !(isRow(row) && row.id === itemId);
    await updateCachedResponses(collection, (cached) =>
      mapRows(cached, (rows) => rows.filter(keep))
    );
    await updateCachedResponses(`${collection}/${itemId}`, () => undefined);
    await reflectInSnapshot(collection, (rows) => rows.filter(keep));
    return undefined;
  }

  // Update of an item, or action on it (`/status`, `/close`…): only the simple fields
  // of the body are carried over — an action does not always have a body.
  if (itemId) {
    const patch: Row = { updatedAt: now, pendingSync: true };
    for (const [key, value] of Object.entries(body)) {
      if (action && typeof value === "object" && value !== null) continue;
      patch[key] = value;
    }
    const merge = (row: unknown) => (isRow(row) && row.id === itemId ? { ...row, ...patch } : row);
    const base = await currentItem(collection, itemId);
    await updateCachedResponses(collection, (cached) => mapRows(cached, (rows) => rows.map(merge)));
    await updateCachedResponses(`${collection}/${itemId}`, (cached) =>
      isRow(cached) ? { ...cached, ...patch } : cached
    );
    await reflectInSnapshot(collection, (rows) => rows.map((row) => merge(row) as Row));
    return { ...(base ?? {}), ...patch, id: itemId };
  }

  // Write on a resource without identifier (`PATCH /api/company`,
  // `PUT /api/company/settings`): merge into the object, or update by key.
  await updateCachedResponses(collection, (cached) => {
    if (Array.isArray(cached) && typeof body.key === "string") {
      const others = cached.filter((row) => !(isRow(row) && row.key === body.key));
      return [...others, body];
    }
    return isRow(cached) && !Array.isArray(cached.items) ? { ...cached, ...body } : cached;
  });
  const current = await readCachedResponse(collection);
  return isRow(current) ? current : { success: true, ...body };
}

// ─── Queueing ─────────────────────────────────────────────────────────────────

/**
 * Queues a write and returns a simulated response. `idempotencyKey` is the key already
 * sent on the first attempt: if that attempt actually reached the server, the replay
 * will not create anything more.
 */
export async function queueHttpWrite(
  payload: HttpWritePayload,
  idempotencyKey: string
): Promise<unknown> {
  const path = pathOf(payload.url);
  await enqueue({
    clientUuid: idempotencyKey,
    entity: HTTP_REQUEST_ENTITY,
    action: payload.method === "POST" && !parsePath(path).itemId ? "create" : "update",
    label: describeWrite(payload.method, path, payload.body),
    payload: { method: payload.method, url: payload.url, body: payload.body ?? null },
  });

  let result: unknown;
  try {
    result = await reflectLocally(payload, idempotencyKey);
  } catch {
    // The reflection is a display convenience: the write itself is safely queued.
    result = isRow(payload.body) ? { ...payload.body, id: idempotencyKey } : undefined;
  }

  await refreshCounters();
  toast.info(i18n.t("offline:write.savedOffline"), {
    id: "offline-write",
    description: i18n.t("offline:write.savedOfflineDescription"),
  });
  return result;
}

// ─── Replay ───────────────────────────────────────────────────────────────────

/**
 * Replaces, in any value, the provisional identifiers with the known server
 * identifiers.
 */
export function substituteIds<T>(value: T, ids: Map<string, string>): T {
  if (ids.size === 0) return value;
  if (typeof value === "string") {
    return value.replace(UUID_GLOBAL, (match) => ids.get(match.toLowerCase()) ?? match) as T;
  }
  if (Array.isArray(value)) return value.map((entry) => substituteIds(entry, ids)) as T;
  if (isRow(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, substituteIds(entry, ids)])
    ) as T;
  }
  return value;
}

/** Request to replay for a queue record, with identifiers resolved. */
export function replayRequest(
  record: OutboxRecord,
  ids: Map<string, string>
): HttpWritePayload & { idempotencyKey: string } {
  const payload = record.payload as unknown as HttpWritePayload;
  return {
    method: payload.method,
    url: substituteIds(payload.url, ids),
    body: payload.body === null ? undefined : substituteIds(payload.body, ids),
    idempotencyKey: record.clientUuid,
  };
}
