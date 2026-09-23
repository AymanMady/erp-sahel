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
 * Endpoints jamais conservés : authentification, administration des accès
 * ([NFR-SEC-5]), état de synchronisation (volatil) et instantané (déjà stocké).
 */
const EXCLUDED_PREFIXES = [
  "/api/auth",
  "/api/users",
  "/api/roles",
  "/api/permissions",
  "/api/sync",
  "/api/health",
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

/**
 * Réponse en cache pour cette URL, ou `undefined`.
 *
 * À défaut de correspondance exacte, une liste paginée est reconstituée à partir d'une
 * réponse plus large portant les mêmes filtres (le préchargement demande 200 lignes :
 * les pages 1 à 8 d'une liste de 25 sont ainsi disponibles).
 */
export async function readCachedResponse(url: string): Promise<unknown> {
  const info = describe(url);
  if (!isCacheable(info.path)) return undefined;
  try {
    const exact = await offlineDb.cache.get(info.key);
    if (exact) return (exact.value as CachedResponse).body;
    if (info.limit === null) return undefined;

    const candidates = await offlineDb.cache
      .where("key")
      .startsWith(`${PREFIX}${info.path}?`)
      .toArray();
    const limit = info.limit;
    for (const row of candidates) {
      const cached = row.value as CachedResponse;
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
  } catch {
    // Lecture impossible : on laisse l'erreur réseau d'origine remonter.
  }
  return undefined;
}
