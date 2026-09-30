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
 * On the desktop, documents (quotes, orders, invoices, returns, payments, purchases)
 * are already in the company's local database once its first synchronization is done,
 * and `local/local-documents.ts` answers them: they are not downloaded again here, one
 * request per document. Only what the local database does not hold is.
 *
 * The first pass starts right after the first synchronization attempt and its progress
 * is published (`onOfflineReadinessChange`): the screen says when the device is ready.
 * The next passes (every 15 minutes) only transfer the lists and the details that
 * changed.
 *
 * A pass never gives up on everything because of one page:
 *  - a request refused for this person (permission, inactive module) is skipped — the
 *    page is empty online too;
 *  - a request the server fails (busy, error, too slow) is tried again a little later,
 *    after the others; the others go on meanwhile;
 *  - only a lost network, or a server failing request after request, ends the pass
 *    early — it resumes as soon as the network is back, or a few minutes later.
 * The device is said ready only once a pass got every page.
 *
 * Controlled cost: a few requests at a time with a short pause between them, instead
 * of competing with what the user is doing.
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
import { api } from "@/shared/api/http";
import { getCachedSession } from "@/shared/auth/token-store";
import { lastKnownOnline, probeServer } from "@/shared/api/network";
import { getMeta, setMeta } from "./db";
import { cachedUpdatedAt, storeCachedResponse } from "./http-cache";
import { answeredLocally } from "./local/local-documents";
import { isLocalReady } from "./local/replication";
import { pullSnapshot, readSnapshot } from "./snapshot";

/**
 * When the next pass may start (milliseconds): 15 minutes after a complete pass, sooner
 * after an incomplete one, now when set to 0. Earlier releases kept `prefetch.lastRunAt`
 * instead: it is not read, so that a device updated from one prepares right away.
 */
const NEXT_RUN_KEY = "prefetch.nextRunAt";
/** Date of the first complete pass: from then on the device works without network. */
const COMPLETED_KEY = "prefetch.completedAt";
/** Incomplete passes in a row: the next one waits longer each time. */
const RETRIES_KEY = "prefetch.retries";
const MIN_INTERVAL_MS = 15 * 60 * 1000;
/** After an incomplete pass, the next one comes this soon — doubled at each new failure. */
const RETRY_INTERVAL_MS = 2 * 60 * 1000;
/** Largest page the server accepts. */
const PAGE_SIZE = 200;
/** Upper bound per list: keeps the device storage reasonable for a very old company. */
const MAX_ROWS = 10_000;
/** Requests in flight at the same time. */
const CONCURRENCY = 3;
/** Pause between two requests of a worker: leaves room for the user's own screens. */
const PAUSE_MS = 100;
/** Tries of a request the server fails, before it waits for the next pass. */
const MAX_ATTEMPTS = 3;
/** Pause before trying such a request again, times the tries already made. */
const RETRY_PAUSE_MS = 2000;
/** Server failures in a row after which it is left alone until the next pass. */
const MAX_FAILURES_IN_A_ROW = 6;
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

/** How a pass went. */
interface Pass {
  /** The network dropped: the pass stopped, it resumes as soon as it is back. */
  offline: boolean;
  /** The server failed request after request: left alone until the next pass. */
  stopped: boolean;
  /** Requests the server still failed after several tries. */
  failed: number;
  failuresInARow: number;
}

let running: Promise<void> | null = null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `refused`: not for this person (permission, inactive module…), skipped. `server`: the
 * server failed, worth trying again. `network`: no answer at all.
 */
function failureOf(error: unknown): "refused" | "server" | "network" {
  if (!(error instanceof ApiError)) return "refused";
  if (error.isNetworkError) return "network";
  return error.status === 429 || error.status >= 500 ? "server" : "refused";
}

async function runAll(tasks: Task[], pass: Pass): Promise<void> {
  publish({ total: readiness.total + tasks.length });
  const queue = tasks.map((task) => ({ task, tries: 0 }));
  let index = 0;
  const worker = async () => {
    while (index < queue.length && !pass.offline && !pass.stopped) {
      // Network lost along the way: no point in chaining failures.
      if (!lastKnownOnline()) {
        pass.offline = true;
        return;
      }
      const entry = queue[index++];
      entry.tries += 1;
      let again = false;
      try {
        await entry.task();
        pass.failuresInARow = 0;
      } catch (error) {
        let failure = failureOf(error);
        // No answer while the server still answers its health check: this request alone
        // failed (too slow). Anything else is a real outage.
        if (failure === "network") {
          if (!(await probeServer())) {
            pass.offline = true;
            return;
          }
          failure = "server";
        }
        if (failure === "server") {
          pass.failuresInARow += 1;
          if (pass.failuresInARow >= MAX_FAILURES_IN_A_ROW) pass.stopped = true;
          if (entry.tries < MAX_ATTEMPTS && !pass.stopped) {
            // Tried again after the others: a busy server gets time to recover.
            queue.push(entry);
            again = true;
          } else {
            pass.failed += 1;
          }
        }
      }
      if (!again) publish({ done: readiness.done + 1 });
      await wait(again ? RETRY_PAUSE_MS * entry.tries : PAUSE_MS);
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
    if (!lastKnownOnline()) break;
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

async function prefetch(pass: Pass): Promise<void> {
  // Customers and products fall back on the snapshot until the desktop's local database
  // is complete: it must be there even when the synchronization could not get it.
  const snapshot = (await readSnapshot()) ?? (await pullSnapshot().catch(() => null));
  const modules = new Set((snapshot?.modules ?? []).map((row) => row.code));
  // A disabled module answers 403: no point in prefetching its screens. Without a
  // module list (old snapshot), everything is prefetched.
  const when = (code: string, tasks: Task[]): Task[] =>
    modules.size === 0 || modules.has(code) ? tasks : [];
  // Documents the desktop's local database answers: nothing to download.
  const unlessLocal = (path: string, tasks: Task[]): Task[] => (answeredLocally(path) ? [] : tasks);
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
  // The receipts of an order are on its page: downloaded with it unless answered here.
  const receiptsLocal = answeredLocally("/api/goods-receipts");

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

    // Master data (products, parties, stock, warehouses…) comes from the snapshot or the
    // local database; only what they do not contain is prefetched here.
    ...when("inventory", [
      list("/api/inventory/movements", (page) => inventoryApi.listMovements(page)),
      () => inventoryApi.valuation(null),
    ]),

    // Party details (contacts, addresses, history): missing from the snapshot. The
    // desktop reads them from its local database once invoices and payments are there.
    ...((["parties", "sales_invoices", "payments"] as const).every(isLocalReady)
      ? []
      : [
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
        ]),

    // Sales, invoicing, payments.
    ...when("sales", [
      ...unlessLocal("/api/quotes", [
        listWithDetails(
          "/api/quotes",
          (page) => salesApi.listQuotes(page),
          (id) => `/api/quotes/${id}`,
          (id) => [() => salesApi.getQuote(id)]
        ),
      ]),
      ...unlessLocal("/api/sales-orders", [
        listWithDetails(
          "/api/sales-orders",
          (page) => salesApi.listOrders(page),
          (id) => `/api/sales-orders/${id}`,
          (id) => [() => salesApi.getOrder(id)]
        ),
      ]),
    ]),
    ...when("invoicing", [
      // An invoice's payments and returns are filtered locally from the complete lists.
      ...unlessLocal("/api/invoices", [
        listWithDetails(
          "/api/invoices",
          (page) => invoicingApi.list(page),
          (id) => `/api/invoices/${id}`,
          (id) => [() => invoicingApi.get(id)]
        ),
      ]),
      ...unlessLocal("/api/credit-notes", [
        listWithDetails(
          "/api/credit-notes",
          (page) => invoicingApi.listCreditNotes(page),
          (id) => `/api/credit-notes/${id}`,
          (id) => [() => invoicingApi.getCreditNote(id)]
        ),
      ]),
    ]),
    ...unlessLocal("/api/payments", [list("/api/payments", (page) => paymentApi.list(page))]),

    // Purchasing.
    ...when("purchasing", [
      ...(answeredLocally("/api/purchase-orders") && receiptsLocal
        ? []
        : [
            listWithDetails(
              "/api/purchase-orders",
              (page) => purchasingApi.listOrders(page),
              (id) => `/api/purchase-orders/${id}`,
              (id) => [
                ...unlessLocal("/api/purchase-orders", [() => purchasingApi.getOrder(id)]),
                ...(receiptsLocal ? [] : [() => purchasingApi.listReceipts(id)]),
              ]
            ),
          ]),
      // The server keeps the receipt list to its latest entries: the screen shows the same.
      ...unlessLocal("/api/goods-receipts", [
        listWithDetails(
          "/api/goods-receipts",
          () => purchasingApi.listReceipts(),
          (id) => `/api/goods-receipts/${id}`,
          (id) => [() => purchasingApi.getReceipt(id)]
        ),
      ]),
      ...unlessLocal("/api/supplier-invoices", [
        // As the screen asks for it (default size), then complete for the details.
        () => purchasingApi.listSupplierInvoices(),
        listWithDetails(
          "/api/supplier-invoices",
          (page) => purchasingApi.listSupplierInvoices(page),
          (id) => `/api/supplier-invoices/${id}`,
          (id) => [() => purchasingApi.getSupplierInvoice(id)]
        ),
      ]),
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
    // Page of the desktop application: its installers, read as the page reads them.
    () => api.get("/api/desktop/downloads"),

    // Synchronization monitoring: a screen of the super-administrator only.
    ...(getCachedSession()?.user.isSuperuser
      ? [() => syncApi.status(), () => syncApi.journal()]
      : []),
  ];

  await runAll(tasks, pass);
  if (!pass.offline && !pass.stopped) await runAll(details, pass);
}

/**
 * Runs a preparation pass: right away while the device has never finished one, then
 * at most every 15 minutes — sooner after a pass the server left incomplete. Never
 * throws; concurrent calls share the same pass.
 */
export async function prefetchForOffline(options: { force?: boolean } = {}): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      if (!lastKnownOnline()) return;
      const [nextRun, completedAt] = await Promise.all([
        getMeta(NEXT_RUN_KEY),
        getMeta(COMPLETED_KEY),
      ]);
      if (!options.force && Date.now() < (Number(nextRun) || 0)) return;
      await wait(completedAt ? REFRESH_DELAY_MS : FIRST_RUN_DELAY_MS);
      if (!lastKnownOnline()) return;
      publish({
        state: completedAt ? "ready" : "preparing",
        completedAt,
        running: true,
        done: 0,
        total: 0,
      });
      const pass: Pass = { offline: false, stopped: false, failed: 0, failuresInARow: 0 };
      await prefetch(pass);
      // Network lost (tab closed, cut): nothing recorded, the next cycle resumes.
      if (pass.offline || !lastKnownOnline()) return;
      if (pass.stopped || pass.failed > 0) {
        // Pages the server could not give: tried again in 2 minutes, then 4, 8…
        const retries = Number((await getMeta(RETRIES_KEY)) ?? 0) || 0;
        const delay = Math.min(MIN_INTERVAL_MS, RETRY_INTERVAL_MS * 2 ** retries);
        await setMeta(RETRIES_KEY, String(retries + 1));
        await setMeta(NEXT_RUN_KEY, String(Date.now() + delay));
        return;
      }
      // Recorded only once the pass is complete: an interrupted pass resumes on the next
      // cycle, not 15 minutes later.
      const now = new Date().toISOString();
      await setMeta(RETRIES_KEY, "0");
      await setMeta(NEXT_RUN_KEY, String(Date.now() + MIN_INTERVAL_MS));
      await setMeta(COMPLETED_KEY, now);
      publish({ state: "ready", completedAt: now });
    } catch {
      // A failed pass catches up on the next cycle.
    } finally {
      publish({ running: false });
      running = null;
    }
  })();
  return running;
}
