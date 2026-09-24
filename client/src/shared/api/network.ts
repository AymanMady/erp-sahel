/**
 * Connectivity detection.
 *
 * `navigator.onLine` only says "a network interface exists": a device connected
 * to a shop's Wi-Fi whose Internet link is down believes it is online. So we
 * confirm with a **server ping** (`GET /api/health`), as prescribed by
 * `SYNC_STRATEGY.md` §8.
 */

const HEALTH_TIMEOUT_MS = 4000;
/** Validity period of a ping result: avoids flooding the server. */
const PROBE_TTL_MS = 10_000;

let lastProbe: { at: number; reachable: boolean } | null = null;
const listeners = new Set<(online: boolean) => void>();

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Queries `/api/health` with a short timeout. Never throws. */
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

/** Last known state, without triggering a request. */
export function lastKnownOnline(): boolean {
  if (!isBrowserOnline()) return false;
  return lastProbe?.reachable ?? true;
}

/** Invalidates the ping cache: called whenever a request fails or succeeds. */
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
