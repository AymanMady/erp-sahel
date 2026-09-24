/**
 * Cache hors-ligne des réponses `GET` de l'API.
 *
 * L'instantané de synchronisation ne couvre que le référentiel. Pour que **toutes** les
 * pages restent consultables sans réseau (factures, commandes, comptabilité, rapports…),
 * chaque réponse `GET` réussie est conservée dans IndexedDB, indexée par son URL
 * normalisée ; hors ligne, `http.ts` la relit au lieu d'échouer. Le préchargement
 * (`offline-prefetch.ts`) remplit ce cache pour les pages jamais ouvertes.
 *
 * Le bandeau « Mode hors ligne » signale à l'utilisateur que les données affichées
 * sont celles de la dernière synchronisation.
 */

import { offlineDb } from "./db";

const PREFIX = "http:";
const PAGINATION_PARAMS = new Set(["limit", "offset"]);

/**
 * Endpoints jamais conservés : authentification (jetons), sonde de santé, et flux de
 * synchronisation déjà stockés ailleurs (instantané, delta). Tout le reste — y compris
 * utilisateurs, rôles et état de synchronisation — doit rester consultable hors ligne.
 * Aucun secret n'y figure : le serveur ne renvoie jamais d'empreinte de mot de passe.
 */
const EXCLUDED_PREFIXES = [
  "/api/auth",
  "/api/health",
  "/api/sync/snapshot",
  "/api/sync/pull",
  "/api/sync/push",
];

/**
 * Listes servies par l'instantané de synchronisation (`offline-reads.ts`) : plus
 * fraîches (delta à chaque cycle), recherchables sans réseau, et complétées par les
 * créations hors ligne. On ne les sert donc pas depuis ce cache.
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
  "/api/modules/auto-parts/countries",
  "/api/modules/auto-parts/quality-levels",
  "/api/modules/auto-parts/manufacturers",
  "/api/modules/auto-parts/vehicles",
]);

interface CachedResponse {
  path: string;
  /** Paramètres hors pagination, normalisés : sert au repli par pagination. */
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
    // Stockage indisponible : la page restera simplement indisponible hors ligne.
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

/** Paramètres sans incidence sur le contenu d'une liste. */
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
 * Applique localement les filtres d'une requête à une liste en cache. Renvoie `null`
 * si un filtre ne peut pas être évalué sur les lignes : mieux vaut « indisponible hors
 * ligne » qu'une liste qui semble filtrée alors qu'elle ne l'est pas.
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

/** Filtres d'une clé de cache, sous forme de paires. */
function filterPairs(filterKey: string): [string, string][] {
  return [...new URLSearchParams(filterKey).entries()];
}

function paginate(body: unknown, items: unknown[], limit: number | null, offset: number) {
  const window = limit === null ? items.slice(offset) : items.slice(offset, offset + limit);
  if (!isPaginated(body)) return window;
  return { ...body, items: window, total: items.length, limit: limit ?? items.length, offset };
}

/**
 * Réponse en cache pour cette URL, ou `undefined`.
 *
 * À défaut de correspondance exacte :
 *  1. une liste paginée est reconstituée à partir d'une réponse plus large portant les
 *     mêmes filtres (le préchargement demande 200 lignes : les pages 1 à 8 d'une liste
 *     de 25 sont ainsi disponibles) ;
 *  2. sinon, les filtres demandés (recherche, statut, dates…) sont appliqués localement
 *     à une liste en cache moins filtrée — chercher une facture hors ligne fonctionne.
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
        // La fenêtre demandée doit être entièrement couverte (ou atteindre la fin de liste).
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

    // Filtrage local : on part de la liste la plus large dont les filtres sont un
    // sous-ensemble de ceux demandés.
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
    // Lecture impossible : on laisse l'erreur réseau d'origine remonter.
  }
  return undefined;
}

function rowsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  return isPaginated(body) ? body.items : [];
}

// ─── Reflet local des écritures hors ligne ───────────────────────────────────

/**
 * Applique `update` à chaque réponse en cache de ce chemin exact (toutes requêtes
 * confondues). `update` renvoie le nouveau corps, ou `undefined` pour le supprimer.
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
    // Reflet impossible : l'écriture reste en file, seul l'affichage est en retard.
  }
}

/** Lignes (listes paginées ou tableaux) en cache pour ce chemin exact. */
export async function cachedRowsOf(path: string): Promise<unknown[]> {
  try {
    const rows = await offlineDb.cache.where("key").startsWith(`${PREFIX}${path}?`).toArray();
    return rows.flatMap((row) => rowsOf((row.value as CachedResponse).body));
  } catch {
    return [];
  }
}

/** Supprime les réponses en cache dont la clé mentionne l'un de ces identifiants. */
export async function forgetCachedResponsesMentioning(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await offlineDb.cache
      .filter((row) => row.key.startsWith(PREFIX) && ids.some((id) => row.key.includes(id)))
      .delete();
  } catch {
    // Entrées orphelines : elles seront écrasées au prochain préchargement.
  }
}

/** Date de mise à jour d'une fiche en cache (champ `updatedAt` de la réponse). */
export async function cachedUpdatedAt(url: string): Promise<string | null> {
  try {
    const row = await offlineDb.cache.get(describe(url).key);
    const body = (row?.value as CachedResponse | undefined)?.body as Row | undefined;
    return typeof body?.updatedAt === "string" ? body.updatedAt : null;
  } catch {
    return null;
  }
}
