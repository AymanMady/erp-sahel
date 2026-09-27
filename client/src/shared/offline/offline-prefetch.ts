/**
 * Offline prefetching: fills the HTTP cache (`http-cache.ts`) so that pages **never
 * opened** on this device stay viewable without network.
 *
 * The same API functions as the pages are called, with their default filters; lists
 * are requested large (200 rows) to cover several pagination pages — and, offline,
 * the other filters are applied locally to these lists (`http-cache.ts`). The detail
 * of each listed document is also prefetched.
 *
 * **Every** page of the app is covered, administration included.
 *
 * Controlled cost: at most one pass every 30 minutes, started only once the screen
 * the user opened has loaded, at most two requests at a time with a short pause
 * between them, details reloaded only if they changed since the previous pass, and
 * every failure (permissions, inactive module) is ignored. A server that says it is
 * busy (429) or unavailable (5xx) stops the pass: it resumes on the next cycle,
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
import { lastKnownOnline } from "@/shared/api/network";
import { cachedUpdatedAt } from "./http-cache";
import { readMeta, writeMeta } from "./storage";
import { readSnapshot } from "./snapshot";

const LAST_RUN_KEY = "prefetch.lastRunAt";
const MIN_INTERVAL_MS = 30 * 60 * 1000;
const LIST_SIZE = 200;
/** Details prefetched per document type: all those of the prefetched list. */
const DETAIL_COUNT = LIST_SIZE;
/**
 * Top-level workers. Nested lists (details of a list) run one request at a time
 * inside their worker, so there are never more than this many requests in flight.
 */
const CONCURRENCY = 2;
/** Pause between two requests of a worker: leaves room for the user's own screens. */
const PAUSE_MS = 150;
/** Delay before a pass starts: the screen just opened (dashboard) loads first. */
const START_DELAY_MS = 20_000;

type Task = () => Promise<unknown>;

let running: Promise<void> | null = null;
/** Set when the server says it is busy or unavailable: ends the current pass. */
let serverStrained = false;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runAll(tasks: Task[], concurrency = 1): Promise<void> {
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
      await wait(PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

interface ListedRow {
  id: string;
  updatedAt: string | null;
}

function rowsOf(result: unknown): ListedRow[] {
  const items = Array.isArray(result)
    ? result
    : ((result as { items?: unknown[] } | null)?.items ?? []);
  return items
    .map((row) => row as { id?: unknown; updatedAt?: unknown })
    .filter((row): row is { id: string; updatedAt?: unknown } => typeof row.id === "string")
    .map((row) => ({
      id: row.id,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
    }))
    .slice(0, DETAIL_COUNT);
}

/**
 * List + details of its items. A detail already cached with the same update date as
 * the list row is not requested again: after the first pass, only modified details
 * are transferred.
 */
function listWithDetails(
  list: () => Promise<unknown>,
  detailPath: (id: string) => string,
  detail: (id: string) => Task[]
): Task {
  return async () => {
    const rows = rowsOf(await list());
    const stale: ListedRow[] = [];
    for (const row of rows) {
      const cached = await cachedUpdatedAt(detailPath(row.id));
      if (!cached || !row.updatedAt || cached !== row.updatedAt) stale.push(row);
    }
    await runAll(stale.flatMap((row) => detail(row.id)));
  };
}

async function prefetch(): Promise<void> {
  const snapshot = await readSnapshot();
  const modules = new Set((snapshot?.modules ?? []).map((row) => row.code));
  // A disabled module answers 403: no point in prefetching its screens. Without a
  // module list (old snapshot), everything is prefetched, as before.
  const when = (code: string, tasks: Task[]): Task[] =>
    modules.size === 0 || modules.has(code) ? tasks : [];
  const page = { limit: LIST_SIZE, offset: 0 };
  const today = todayInput();
  const last30Days = { fromDate: addDays(today, -29), toDate: today };

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
      () => inventoryApi.listMovements(page),
      () => inventoryApi.valuation(null),
    ]),

    // Party details (contacts, addresses, history): missing from the snapshot.
    async () => {
      const parties = [...(snapshot?.parties ?? [])]
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, DETAIL_COUNT);
      const stale = [];
      for (const party of parties) {
        const cached = await cachedUpdatedAt(`/api/parties/${party.id}`);
        if (!cached || cached !== String(party.updatedAt)) stale.push(party.id);
      }
      await runAll(stale.map((id) => () => partyApi.get(id)));
    },

    // Sales, invoicing, payments.
    ...when("sales", [
      listWithDetails(
        () => salesApi.listQuotes(page),
        (id) => `/api/quotes/${id}`,
        (id) => [() => salesApi.getQuote(id)]
      ),
      listWithDetails(
        () => salesApi.listOrders(page),
        (id) => `/api/sales-orders/${id}`,
        (id) => [() => salesApi.getOrder(id)]
      ),
    ]),
    ...when("invoicing", [
      listWithDetails(
        () => invoicingApi.list(page),
        (id) => `/api/invoices/${id}`,
        (id) => [() => invoicingApi.get(id), () => paymentApi.list({ invoiceId: id })]
      ),
      () => invoicingApi.listCreditNotes(page),
    ]),
    () => paymentApi.list(page),

    // Purchasing.
    ...when("purchasing", [
      listWithDetails(
        () => purchasingApi.listOrders(page),
        (id) => `/api/purchase-orders/${id}`,
        (id) => [() => purchasingApi.getOrder(id), () => purchasingApi.listReceipts(id)]
      ),
      () => purchasingApi.listReceipts(),
      () => purchasingApi.listSupplierInvoices(),
    ]),

    // Treasury and accounting.
    () => bankingApi.listAccounts(),
    () => bankingApi.listPaymentAccounts(),
    ...when("banking", [() => bankingApi.totals(), () => bankingApi.listTransactions(page)]),
    ...when("accounting", [
      () => accountingApi.listAccounts(),
      () => accountingApi.listJournals(),
      () => accountingApi.listMappings(),
      () => accountingApi.listFiscalYears(),
      () => accountingApi.listEntries({ limit: 50 }),
      () => accountingApi.ledger({ limit: 50, offset: 0 }),
      () => accountingApi.balance({}),
    ]),

    // Point of sale.
    ...when("pos", [
      () => posApi.listSessions(),
      ...(snapshot?.session ? [() => posApi.sessionSummary(snapshot.session!.id)] : []),
    ]),

    // Settings and administration (company, numbering, modules, accounts, roles).
    () => settingsApi.getCompany(),
    () => settingsApi.listSettings(),
    () => settingsApi.listSequences(),
    () => settingsApi.listModules(),
    () => settingsApi.listUsers(),
    () => settingsApi.listRoles(),
    () => settingsApi.listPermissions(),

    // Synchronization monitoring.
    () => syncApi.status(),
    () => syncApi.journal(),
  ];

  await runAll(tasks, CONCURRENCY);
}

/**
 * Runs a prefetch pass if the previous one is more than 30 minutes old.
 * Never throws; concurrent calls share the same pass.
 */
export async function prefetchForOffline(options: { force?: boolean } = {}): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      if (!lastKnownOnline()) return;
      const lastRun = Number((await readMeta(LAST_RUN_KEY)) ?? 0);
      if (!options.force && Date.now() - lastRun < MIN_INTERVAL_MS) return;
      await wait(START_DELAY_MS);
      if (!lastKnownOnline()) return;
      serverStrained = false;
      await prefetch();
      // Timestamped only once the pass is complete: an interrupted pass (tab closed,
      // network lost, server busy) is resumed on the next cycle, not 30 minutes later.
      if (lastKnownOnline() && !serverStrained) await writeMeta(LAST_RUN_KEY, String(Date.now()));
    } catch {
      // A failed prefetch will catch up on the next pass.
    } finally {
      running = null;
    }
  })();
  return running;
}
