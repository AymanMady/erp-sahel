/**
 * Détection de connectivité.
 *
 * `navigator.onLine` ne dit que « une interface réseau existe » : un poste connecté
 * au Wi-Fi d'un magasin dont la liaison Internet est coupée se croit en ligne. On
 * confirme donc par un **ping serveur** (`GET /api/health`), comme prescrit par
 * `SYNC_STRATEGY.md` §8.
 */

const HEALTH_TIMEOUT_MS = 4000;
/** Durée de validité d'un résultat de ping : évite d'inonder le serveur. */
const PROBE_TTL_MS = 10_000;

let lastProbe: { at: number; reachable: boolean } | null = null;
const listeners = new Set<(online: boolean) => void>();

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Interroge `/api/health` avec un délai court. Ne lève jamais. */
export async function probeServer(force = false): Promise<boolean> {
  if (!isBrowserOnline()) {
    updateProbe(false);
    return false;
  }
  const now = Date.now();
  if (!force && lastProbe && now - lastProbe.at < PROBE_TTL_MS) {
    return lastProbe.reachable;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch("/api/health", {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    updateProbe(response.ok);
    return response.ok;
  } catch {
    updateProbe(false);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function updateProbe(reachable: boolean): void {
  const changed = lastProbe?.reachable !== reachable;
  lastProbe = { at: Date.now(), reachable };
  if (changed) {
    for (const listener of listeners) listener(reachable);
  }
}

/** Dernier état connu, sans déclencher de requête. */
export function lastKnownOnline(): boolean {
  if (!isBrowserOnline()) return false;
  return lastProbe?.reachable ?? true;
}

/** Invalide le cache de ping : appelé dès qu'une requête échoue ou réussit. */
export function reportNetworkResult(reachable: boolean): void {
  updateProbe(reachable);
}

export function onConnectivityChange(listener: (online: boolean) => void): () => void {
  listeners.add(listener);
  const handleOnline = () => void probeServer(true);
  const handleOffline = () => updateProbe(false);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}
