/**
 * Offline preparation: after sign-in, downloads **everything** the screens need, so
 * that the device then works without network — pages never opened included.
 *
 * The HTTP cache (`http-cache.ts`) is filled by calling the same API functions as the
 * pages:
 *  1. every list, **complete** (page after page, up to `MAX_ROWS`), and the summaries
 *     (dashboard, reports, accounting, administration);
 *  2. the detail of **every** listed document (invoice, return, order, receipt,
 *     supplier invoice, customer…), most recent first.
 * Offline, pagination, search and filters are then applied locally to these lists.
 * Master data (products, stock, customers, warehouses) comes from the synchronization
 * snapshot.
 *
 * The first pass starts right after the snapshot and its progress is published
 * (`onOfflineReadinessChange`): the screen says when the device is ready. The next
 * passes (every 15 minutes) only transfer the lists and the details that changed.
 *
 * Controlled cost: a few requests at a time with a short pause between them, every
 * failure (permissions, inactive module) ignored. A server that says it is busy (429)
 * or unavailable (5xx) stops the pass: it resumes on the next synchronization cycle,
 * instead of competing with what the user is doing.
 */

import { addDays, todayInput } from "@shared/format";
import { accountingApi } from "@/entities/accounting/api";
import { bankingApi } from "@/entities/banking/api";
import { inventoryApi } from "@/entities/inventory/api";
import { invoicingApi } from "@/entities/invoicing/api";
import { partyApi } from "@/entities/party/api";
import { paymentApi } from "@/entities/payment/api";
import { posApi } from "@/entities/pos/api";
import { purchasingApi } from "@/entities/purchasing/api";
import { reportsApi } from "@/entities/reports/api";
import { salesApi } from "@/entities/sales/api";
import { settingsApi } from "@/entities/settings/api";
import { syncApi } from "@/entities/sync/api";
import { ApiError } from "@/shared/api/api-error";
import { getCachedSession } from "@/shared/auth/token-store";
import { lastKnownOnline } from "@/shared/api/network";
import { getMeta, setMeta } from "./db";
import { cachedUpdatedAt, storeCachedResponse } from "./http-cache";
import { readSnapshot } from "./snapshot";

const LAST_RUN_KEY = "prefetch.lastRunAt";
/** Date of the first complete pass: from then on the device works without network. */
const COMPLETED_KEY = "prefetch.completedAt";
const MIN_INTERVAL_MS = 15 * 60 * 1000;
/** Largest page the server accepts. */
const PAGE_SIZE = 200;
/** Upper bound per list: keeps the device storage reasonable for a very old company. */
const MAX_ROWS = 10_000;
/** Requests in flight at the same time. */
const CONCURRENCY = 3;
/** Pause between two requests of a worker: leaves room for the user's own screens. */
const PAUSE_MS = 100;
/** Delay before a refresh pass: the screen just opened loads first. */
const REFRESH_DELAY_MS = 20_000;
/** Before the first complete pass, the device is not ready yet: no waiting. */
const FIRST_RUN_DELAY_MS = 1000;

type Task = () => Promise<unknown>;

// ─── Progress ────────────────────────────────────────────────────────────────

export interface OfflineReadiness {
  /**
   * `unknown`: not read yet; `preparing`: first download in progress, the device is not
   * ready to work without network; `ready`: everything was downloaded at least once.
   */
  state: "unknown" | "preparing" | "ready";
  /** A pass is running (first download or refresh). */
  running: boolean;
  done: number;
  total: number;
  completedAt: string | null;
}

let readiness: OfflineReadiness = {
  state: "unknown",
  running: false,
  done: 0,
  total: 0,
  completedAt: null,
};
const listeners = new Set<(value: OfflineReadiness) => void>();

function publish(patch: Partial<OfflineReadiness>): void {
  readiness = { ...readiness, ...patch };
  for (const listener of listeners) listener(readiness);
}

export function getOfflineReadiness(): OfflineReadiness {
  return readiness;
}

export function onOfflineReadinessChange(listener: (value: OfflineReadiness) => void): () => void {
  listeners.add(listener);
  listener(readiness);
  return () => listeners.delete(listener);
}

/** Reads whether this device already finished a complete download. */
export async function initialiseOfflineReadiness(): Promise<void> {
  const completedAt = await getMeta(COMPLETED_KEY);
  if (readiness.running) return;
  publish({ state: completedAt ? "ready" : "preparing", completedAt });
}

// ─── Running the requests ────────────────────────────────────────────────────

let running: Promise<void> | null = null;
/** Set when the server says it is busy or unavailable: ends the current pass. */
let serverStrained = false;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runAll(tasks: Task[]): Promise<void> {
  publish({ total: readiness.total + tasks.length });
  let index = 0;
  const worker = async () => {
    while (index < tasks.length) {
      const task = tasks[index++];
      // Server lost or overloaded along the way: no point in chaining failures.
      if (!lastKnownOnline() || serverStrained) return;
      try {
        await task();
      } catch (error) {
        // Missing permission, inactive module…: the corresponding page will stay empty.
        if (error instanceof ApiError && (error.status === 429 || error.status >= 500)) {
          serverStrained = true;
        }
      }
      publish({ done: readiness.done + 1 });
      await wait(PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

interface ListedRow {
  id: string;
  updatedAt: string | null;
}

function itemsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const items = (result as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items : [];
}

function rowsOf(items: unknown[]): ListedRow[] {
  return items
    .map((row) => row as { id?: unknown; updatedAt?: unknown })
    .filter((row): row is { id: string; updatedAt?: unknown } => typeof row.id === "string")
    .map((row) => ({
      id: row.id,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
    }));
}

type Page = { limit: number; offset: number };

/**
 * Downloads a whole list, page after page, and keeps it as **one** response: offline,
 * every page, search and filter of the screen is served from it (`http-cache.ts`).
 * Returns the rows.
 */
async function fetchAll(path: string, fetchPage: (page: Page) => Promise<unknown>) {
  const first = await fetchPage({ limit: PAGE_SIZE, offset: 0 });
  const items = [...itemsOf(first)];
  const total = (first as { total?: unknown } | null)?.total;
  const expected = typeof total === "number" ? Math.min(total, MAX_ROWS) : MAX_ROWS;
  let lastCount = items.length;
  while (lastCount === PAGE_SIZE && items.length < expected) {
    if (!lastKnownOnline() || serverStrained) break;
    await wait(PAUSE_MS);
    const next = itemsOf(await fetchPage({ limit: PAGE_SIZE, offset: items.length }));
    items.push(...next);
    lastCount = next.length;
  }
  if (items.length > PAGE_SIZE) {
    const body = Array.isArray(first)
      ? items
      : { ...(first as object), items, total: typeof total === "number" ? total : items.length };
    await storeCachedResponse(`${path}?limit=${items.length}&offset=0`, body);
  }
  return items;
}

/**
 * Keeps the detail tasks of the rows whose detail is missing or older than the list.
 * After the first pass, only modified documents are transferred again.
 */
async function staleDetails(
  items: unknown[],
  detailPath: (id: string) => string,
  detail: (id: string) => Task[]
): Promise<Task[]> {
  const tasks: Task[] = [];
  for (const row of rowsOf(items)) {
    const cached = await cachedUpdatedAt(detailPath(row.id));
    if (!cached || !row.updatedAt || cached !== row.updatedAt) tasks.push(...detail(row.id));
  }
  return tasks;
}

async function prefetch(): Promise<void> {
  const snapshot = await readSnapshot();
  const modules = new Set((snapshot?.modules ?? []).map((row) => row.code));
  // A disabled module answers 403: no point in prefetching its screens. Without a
  // module list (old snapshot), everything is prefetched.
  const when = (code: string, tasks: Task[]): Task[] =>
    modules.size === 0 || modules.has(code) ? tasks : [];
  const today = todayInput();
  const last30Days = { fromDate: addDays(today, -29), toDate: today };

  // Details are discovered while lists download; they run in a second phase.
  const details: Task[] = [];
  /** A complete list, then the detail of each of its documents. */
  const listWithDetails =
    (
      path: string,
      fetchPage: (page: Page) => Promise<unknown>,
      detailPath: (id: string) => string,
      detail: (id: string) => Task[]
    ): Task =>
    async () => {
      const items = await fetchAll(path, fetchPage);
      details.push(...(await staleDetails(items, detailPath, detail)));
    };
  const list =
    (path: string, fetchPage: (page: Page) => Promise<unknown>): Task =>
    () =>
      fetchAll(path, fetchPage);

  const tasks: Task[] = [
    // Dashboard (each offered period) and reports (default periods).
    ...[7, 30, 90].map(
      (days) => () => reportsApi.dashboard({ fromDate: addDays(today, -(days - 1)), toDate: today })
    ),
    ...when("reports", [
      () => reportsApi.sales(last30Days),
      () => reportsApi.purchases(last30Days),
      () => reportsApi.stock(null),
    ]),

    // Master data (products, parties, stock, warehouses…) comes from the snapshot;
    // only what it does not contain is prefetched here.
    ...when("inventory", [
      list("/api/inventory/movements", (page) => inventoryApi.listMovements(page)),
      () => inventoryApi.valuation(null),
    ]),

    // Party details (contacts, addresses, history): missing from the snapshot.
    async () => {
      const parties = [...(snapshot?.parties ?? [])].sort((a, b) =>
        String(b.updatedAt).localeCompare(String(a.updatedAt))
      );
      const stale: string[] = [];
      for (const party of parties) {
        const cached = await cachedUpdatedAt(`/api/parties/${party.id}`);
        if (!cached || cached !== String(party.updatedAt)) stale.push(party.id);
      }
      details.push(...stale.map((id) => () => partyApi.get(id)));
    },

    // Sales, invoicing, payments.
    ...when("sales", [
      listWithDetails(
        "/api/quotes",
        (page) => salesApi.listQuotes(page),
        (id) => `/api/quotes/${id}`,
        (id) => [() => salesApi.getQuote(id)]
      ),
      listWithDetails(
        "/api/sales-orders",
        (page) => salesApi.listOrders(page),
        (id) => `/api/sales-orders/${id}`,
        (id) => [() => salesApi.getOrder(id)]
      ),
    ]),
    ...when("invoicing", [
      // An invoice's payments and returns are filtered locally from the complete lists.
      listWithDetails(
        "/api/invoices",
        (page) => invoicingApi.list(page),
        (id) => `/api/invoices/${id}`,
        (id) => [() => invoicingApi.get(id)]
      ),
      listWithDetails(
        "/api/credit-notes",
        (page) => invoicingApi.listCreditNotes(page),
        (id) => `/api/credit-notes/${id}`,
        (id) => [() => invoicingApi.getCreditNote(id)]
      ),
    ]),
    list("/api/payments", (page) => paymentApi.list(page)),

    // Purchasing.
    ...when("purchasing", [
      listWithDetails(
        "/api/purchase-orders",
        (page) => purchasingApi.listOrders(page),
        (id) => `/api/purchase-orders/${id}`,
        (id) => [() => purchasingApi.getOrder(id), () => purchasingApi.listReceipts(id)]
      ),
      // The server keeps the receipt list to its latest entries: the screen shows the same.
      listWithDetails(
        "/api/goods-receipts",
        () => purchasingApi.listReceipts(),
        (id) => `/api/goods-receipts/${id}`,
        (id) => [() => purchasingApi.getReceipt(id)]
      ),
      // As the screen asks for it (default size), then complete for the details.
      () => purchasingApi.listSupplierInvoices(),
      listWithDetails(
        "/api/supplier-invoices",
        (page) => purchasingApi.listSupplierInvoices(page),
        (id) => `/api/supplier-invoices/${id}`,
        (id) => [() => purchasingApi.getSupplierInvoice(id)]
      ),
    ]),

    // Treasury and accounting.
    () => bankingApi.listAccounts(),
    () => bankingApi.listPaymentAccounts(),
    ...when("banking", [
      () => bankingApi.totals(),
      list("/api/banking/transactions", (page) => bankingApi.listTransactions(page)),
    ]),
    ...when("accounting", [
      () => accountingApi.listAccounts(),
      () => accountingApi.listJournals(),
      () => accountingApi.listMappings(),
      () => accountingApi.listFiscalYears(),
      list("/api/accounting/entries", (page) => accountingApi.listEntries(page)),
      list("/api/accounting/ledger", (page) => accountingApi.ledger(page)),
      () => accountingApi.balance({}),
    ]),

    // Point of sale.
    ...when("pos", [
      () => posApi.listSessions(),
      ...(snapshot?.session ? [() => posApi.sessionSummary(snapshot.session!.id)] : []),
    ]),

    // Settings and administration (company, modules, accounts, roles).
    () => settingsApi.getCompany(),
    () => settingsApi.listSettings(),
    () => settingsApi.listModules(),
    () => settingsApi.listUsers(),
    () => settingsApi.listRoles(),
    () => settingsApi.listPermissions(),

    // Synchronization monitoring: a screen of the super-administrator only.
    ...(getCachedSession()?.user.isSuperuser
      ? [() => syncApi.status(), () => syncApi.journal()]
      : []),
  ];

  await runAll(tasks);
  await runAll(details);
}

/**
 * Runs a preparation pass: right away while the device has never finished one, then
 * at most every 15 minutes. Never throws; concurrent calls share the same pass.
 */
export async function prefetchForOffline(options: { force?: boolean } = {}): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      if (!lastKnownOnline()) return;
      const [lastRun, completedAt] = await Promise.all([
        getMeta(LAST_RUN_KEY),
        getMeta(COMPLETED_KEY),
      ]);
      if (!options.force && Date.now() - Number(lastRun ?? 0) < MIN_INTERVAL_MS) return;
      await wait(completedAt ? REFRESH_DELAY_MS : FIRST_RUN_DELAY_MS);
      if (!lastKnownOnline()) return;
      serverStrained = false;
      publish({
        state: completedAt ? "ready" : "preparing",
        completedAt,
        running: true,
        done: 0,
        total: 0,
      });
      await prefetch();
      // Recorded only once the pass is complete: an interrupted pass (tab closed,
      // network lost, server busy) resumes on the next cycle, not 15 minutes later.
      if (lastKnownOnline() && !serverStrained) {
        const now = new Date().toISOString();
        await setMeta(LAST_RUN_KEY, String(Date.now()));
        await setMeta(COMPLETED_KEY, now);
        publish({ state: "ready", completedAt: now });
      }
    } catch {
      // A failed pass catches up on the next cycle.
    } finally {
      publish({ running: false });
      running = null;
    }
  })();
  return running;
}
