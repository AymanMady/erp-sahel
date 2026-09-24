/**
 * Offline cache of API `GET` responses.
 *
 * The synchronization snapshot only covers master data. So that **every** page stays
 * viewable without network (invoices, orders, accounting, reports…), each successful
 * `GET` response is kept in IndexedDB, keyed by its normalized URL; offline, `http.ts`
 * reads it back instead of failing. Prefetching (`offline-prefetch.ts`) fills this
 * cache for pages never opened.
 *
 * The "Offline mode" banner tells the user that the displayed data is from the last
 * synchronization.
 */

import { offlineDb } from "./db";

const PREFIX = "http:";
const PAGINATION_PARAMS = new Set(["limit", "offset"]);

/**
 * Endpoints never kept: authentication (tokens), health probe, and synchronization
 * streams already stored elsewhere (snapshot, delta). Everything else — including
 * users, roles and synchronization status — must stay viewable offline. No secret is
 * stored: the server never returns a password hash.
 */
const EXCLUDED_PREFIXES = [
  "/api/auth",
  "/api/health",
  "/api/sync/snapshot",
  "/api/sync/pull",
  "/api/sync/push",
];

/**
 * Lists served by the synchronization snapshot (`offline-reads.ts`): fresher (delta on
 * every cycle), searchable without network, and completed with offline creations. So
 * they are not served from this cache.
 */
const SNAPSHOT_BACKED_PATHS = new Set([
  "/api/catalog/products",
  "/api/catalog/categories",
  "/api/parties",
  "/api/services",
  "/api/inventory/stock",
  "/api/inventory/low-stock",
  "/api/warehouses",
  "/api/pos/registers",
  "/api/pos/sessions/current",
]);

interface CachedResponse {
  path: string;
  /** Non-pagination parameters, normalized: used for the pagination fallback. */
  filterKey: string;
  limit: number | null;
  offset: number;
  body: unknown;
}

function isCacheable(path: string): boolean {
  return (
    path.startsWith("/api/") &&
    !SNAPSHOT_BACKED_PATHS.has(path) &&
    !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function describe(url: string) {
  const parsed = new URL(url, "http://local");
  const entries = [...parsed.searchParams.entries()].sort(([a, va], [b, vb]) =>
    a === b ? va.localeCompare(vb) : a.localeCompare(b)
  );
  const filters = entries.filter(([key]) => !PAGINATION_PARAMS.has(key));
  const limit = parsed.searchParams.get("limit");
  return {
    path: parsed.pathname,
    key: `${PREFIX}${parsed.pathname}?${new URLSearchParams(entries).toString()}`,
    filterKey: new URLSearchParams(filters).toString(),
    limit: limit ? Number(limit) : null,
    offset: Number(parsed.searchParams.get("offset") ?? 0),
  };
}

export async function storeCachedResponse(url: string, body: unknown): Promise<void> {
  const info = describe(url);
  if (!isCacheable(info.path)) return;
  try {
    await offlineDb.cache.put({
      key: info.key,
      value: {
        path: info.path,
        filterKey: info.filterKey,
        limit: info.limit,
        offset: info.offset,
        body,
      } satisfies CachedResponse,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Storage unavailable: the page will simply stay unavailable offline.
  }
}

interface PaginatedBody {
  items: unknown[];
  total?: number;
}

function isPaginated(body: unknown): body is PaginatedBody {
  return typeof body === "object" && body !== null && Array.isArray((body as PaginatedBody).items);
}

type Row = Record<string, unknown>;

/** Parameters with no effect on the content of a list. */
const NEUTRAL_PARAMS = new Set(["includeArchived", "sort", "order"]);
const SEARCH_PARAMS = new Set(["search", "q", "term", "reference"]);
const FROM_PARAMS = new Set(["fromDate", "from", "dateFrom", "startDate"]);
const TO_PARAMS = new Set(["toDate", "to", "dateTo", "endDate"]);
const DATE_FIELDS = [
  "date",
  "issueDate",
  "paymentDate",
  "orderDate",
  "entryDate",
  "movementDate",
  "receivedAt",
  "createdAt",
];

function dateOf(row: Row): string | null {
  for (const field of DATE_FIELDS) {
    const value = row[field];
    if (typeof value === "string" && value) return value.slice(0, 10);
  }
  return null;
}

function matchesSearch(row: Row, term: string): boolean {
  return Object.values(row).some(
    (value) =>
      (typeof value === "string" || typeof value === "number") &&
      String(value).toLowerCase().includes(term)
  );
}

/**
 * Applies a request's filters locally to a cached list. Returns `null` if a filter
 * cannot be evaluated on the rows: "unavailable offline" is better than a list that
 * looks filtered when it is not.
 */
function filterRows(rows: unknown[], filters: [string, string][]): unknown[] | null {
  let result = rows.filter((row): row is Row => typeof row === "object" && row !== null);
  for (const [key, value] of filters) {
    if (NEUTRAL_PARAMS.has(key)) continue;
    if (SEARCH_PARAMS.has(key)) {
      const term = value.trim().toLowerCase();
      if (term) result = result.filter((row) => matchesSearch(row, term));
      continue;
    }
    if (FROM_PARAMS.has(key) || TO_PARAMS.has(key)) {
      const bound = value.slice(0, 10);
      const after = FROM_PARAMS.has(key);
      result = result.filter((row) => {
        const date = dateOf(row);
        return date === null || (after ? date >= bound : date <= bound);
      });
      continue;
    }
    if (key === "unpaidOnly" && value === "true") {
      if (!result.every((row) => "balanceCents" in row || "amountDueCents" in row)) return null;
      result = result.filter((row) => Number(row.balanceCents ?? row.amountDueCents ?? 0) > 0);
      continue;
    }
    if (!result.some((row) => key in row)) {
      if (result.length === 0) continue;
      return null;
    }
    result = result.filter((row) => String(row[key] ?? "") === value);
  }
  return result;
}

/** Filters of a cache key, as pairs. */
function filterPairs(filterKey: string): [string, string][] {
  return [...new URLSearchParams(filterKey).entries()];
}

function paginate(body: unknown, items: unknown[], limit: number | null, offset: number) {
  const window = limit === null ? items.slice(offset) : items.slice(offset, offset + limit);
  if (!isPaginated(body)) return window;
  return { ...body, items: window, total: items.length, limit: limit ?? items.length, offset };
}

/**
 * Cached response for this URL, or `undefined`.
 *
 * Without an exact match:
 *  1. a paginated list is rebuilt from a wider response with the same filters
 *     (prefetching asks for 200 rows: pages 1 to 8 of a 25-row list are thus
 *     available);
 *  2. otherwise, the requested filters (search, status, dates…) are applied locally
 *     to a less filtered cached list — searching for an invoice offline works.
 */
export async function readCachedResponse(url: string): Promise<unknown> {
  const info = describe(url);
  if (!isCacheable(info.path)) return undefined;
  try {
    const exact = await offlineDb.cache.get(info.key);
    if (exact) return (exact.value as CachedResponse).body;

    const candidates = (
      await offlineDb.cache.where("key").startsWith(`${PREFIX}${info.path}?`).toArray()
    ).map((row) => row.value as CachedResponse);

    if (info.limit !== null) {
      const limit = info.limit;
      for (const cached of candidates) {
        if (cached.filterKey !== info.filterKey || !isPaginated(cached.body)) continue;
        const start = info.offset - cached.offset;
        const cachedCount = cached.body.items.length;
        const total = cached.body.total ?? cachedCount;
        // The requested window must be fully covered (or reach the end of the list).
        if (start < 0 || (start + limit > cachedCount && cached.offset + cachedCount < total)) {
          continue;
        }
        return {
          ...cached.body,
          items: cached.body.items.slice(start, start + limit),
          limit,
          offset: info.offset,
        };
      }
    }

    // Local filtering: start from the widest list whose filters are a subset of
    // the requested ones.
    const wanted = filterPairs(info.filterKey);
    const wantedSet = new Set(wanted.map(([key, value]) => `${key}=${value}`));
    const bases = candidates
      .filter((cached) => cached.offset === 0)
      .filter((cached) => Array.isArray(cached.body) || isPaginated(cached.body))
      .filter((cached) =>
        filterPairs(cached.filterKey).every(([key, value]) => wantedSet.has(`${key}=${value}`))
      )
      .sort((a, b) => rowsOf(b.body).length - rowsOf(a.body).length);
    for (const base of bases) {
      const applied = new Set(filterPairs(base.filterKey).map(([key, value]) => `${key}=${value}`));
      const remaining = wanted.filter(([key, value]) => !applied.has(`${key}=${value}`));
      const rows = filterRows(rowsOf(base.body), remaining);
      if (rows === null) continue;
      return paginate(base.body, rows, info.limit, info.offset);
    }
  } catch {
    // Read impossible: let the original network error propagate.
  }
  return undefined;
}

function rowsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  return isPaginated(body) ? body.items : [];
}

// ─── Local reflection of offline writes ──────────────────────────────────────

/**
 * Applies `update` to every cached response of this exact path (all queries
 * combined). `update` returns the new body, or `undefined` to delete it.
 */
export async function updateCachedResponses(
  path: string,
  update: (body: unknown) => unknown
): Promise<void> {
  try {
    const rows = await offlineDb.cache.where("key").startsWith(`${PREFIX}${path}?`).toArray();
    for (const row of rows) {
      const cached = row.value as CachedResponse;
      const next = update(cached.body);
      if (next === undefined) {
        await offlineDb.cache.delete(row.key);
      } else {
        await offlineDb.cache.put({ ...row, value: { ...cached, body: next } });
      }
    }
  } catch {
    // Reflection impossible: the write stays queued, only the display lags behind.
  }
}

/** Cached rows (paginated lists or arrays) for this exact path. */
export async function cachedRowsOf(path: string): Promise<unknown[]> {
  try {
    const rows = await offlineDb.cache.where("key").startsWith(`${PREFIX}${path}?`).toArray();
    return rows.flatMap((row) => rowsOf((row.value as CachedResponse).body));
  } catch {
    return [];
  }
}

/** Deletes cached responses whose key mentions one of these identifiers. */
export async function forgetCachedResponsesMentioning(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await offlineDb.cache
      .filter((row) => row.key.startsWith(PREFIX) && ids.some((id) => row.key.includes(id)))
      .delete();
  } catch {
    // Orphan entries: they will be overwritten by the next prefetch.
  }
}

/** Update date of a cached record (the response's `updatedAt` field). */
export async function cachedUpdatedAt(url: string): Promise<string | null> {
  try {
    const row = await offlineDb.cache.get(describe(url).key);
    const body = (row?.value as CachedResponse | undefined)?.body as Row | undefined;
    return typeof body?.updatedAt === "string" ? body.updatedAt : null;
  } catch {
    return null;
  }
}
