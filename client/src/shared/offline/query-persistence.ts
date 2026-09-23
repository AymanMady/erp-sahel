/**
 * Persistance du cache TanStack Query dans IndexedDB.
 *
 * L'instantané de synchronisation ne couvre que le référentiel (catalogue, tiers,
 * stock). Pour les documents — factures, devis, commandes, règlements, rapports — on
 * conserve la **dernière réponse consultée** : après un rechargement hors ligne,
 * l'écran réaffiche ces données au lieu d'une erreur, puis se rafraîchit dès le retour
 * du réseau.
 *
 * Le cache est vidé avec `queryClient.clear()` (déconnexion, changement de société) :
 * l'écriture suivante persiste alors un cache vide.
 */

import { dehydrate, hydrate, type QueryClient, type Query } from "@tanstack/react-query";

import { getCache, setCache } from "./db";

const CACHE_KEY = "query-cache";
/** Au-delà, une donnée persistée est jugée trop ancienne pour être réaffichée. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WRITE_DELAY_MS = 1000;
/** Version du format : l'incrémenter invalide les caches existants. */
const BUSTER = "1";

/**
 * Clés jamais persistées : données d'administration sensibles ([NFR-SEC-5]), état
 * volatil, ou déjà stockées ailleurs (instantané de caisse).
 */
const EXCLUDED_ROOTS = new Set([
  "session",
  "users",
  "roles",
  "permissions",
  "sync-status",
  "pos-snapshot",
]);

interface PersistedCache {
  buster: string;
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
}

function shouldPersist(query: Query): boolean {
  if (query.state.status !== "success") return false;
  const root = query.queryKey[0];
  return typeof root !== "string" || !EXCLUDED_ROOTS.has(root);
}

/** Recharge le cache persisté. À appeler avant le premier rendu. Ne lève jamais. */
export async function restoreQueryCache(client: QueryClient): Promise<void> {
  try {
    const persisted = await getCache<PersistedCache>(CACHE_KEY);
    if (!persisted || persisted.buster !== BUSTER) return;
    if (Date.now() - persisted.savedAt > MAX_AGE_MS) return;
    hydrate(client, persisted.state);
  } catch {
    // Cache illisible : l'application repart simplement d'un cache vide.
  }
}

/** Écrit le cache (avec un léger différé) à chaque changement. Renvoie le désabonnement. */
export function persistQueryCache(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = () => {
    timer = null;
    const state = dehydrate(client, { shouldDehydrateQuery: shouldPersist });
    void setCache(CACHE_KEY, {
      buster: BUSTER,
      savedAt: Date.now(),
      state,
    } satisfies PersistedCache);
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" && event.type !== "removed") return;
    if (timer) return;
    timer = setTimeout(write, WRITE_DELAY_MS);
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
