/**
 * Connectivity detection.
 *
 * `navigator.onLine` only says "a network interface exists": a device connected
 * to a shop's Wi-Fi whose Internet link is down believes it is online. So we
 * confirm with a **server ping**, as prescribed by `SYNC_STRATEGY.md` §8. The ping
 * also checks the server's database (`GET /api/health/db`): a server that answers but
 * cannot reach its data is of no use, the device must work from its local copy.
 *
 * Going offline is a heavy switch (banner, cached data, queued writes), so it is
 * only declared once **confirmed**: a single slow request or a single lost ping
 * (server cold start, database waking up, weak mobile signal) is not an outage.
 */

import { apiUrl } from "@/shared/desktop/desktop";

const HEALTH_PATH = "/api/health/db";
/** Generous: a serverless instance starting cold can take several seconds. */
const HEALTH_TIMEOUT_MS = 8000;
/** Validity period of a ping result: avoids flooding the server. */
const PROBE_TTL_MS = 10_000;
/** Pause before the confirmation ping that follows a failed one. */
const CONFIRM_DELAY_MS = 1500;
/** Background revalidation, shared by every subscriber. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Answers that do not mean "server reachable": the gateway is there but the API is
 * not. Any other answer — even 429 (too many requests) or 401 — proves the server
 * responds, so the device is online.
 */
const UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

let lastProbe: { at: number; reachable: boolean } | null = null;
let probeInFlight: Promise<boolean> | null = null;
const listeners = new Set<(online: boolean) => void>();

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pingOnce(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(HEALTH_PATH), {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    return !UNAVAILABLE_STATUSES.has(response.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Queries the health endpoint with a short timeout. Never throws. */
export async function probeServer(force = false): Promise<boolean> {
  if (!isBrowserOnline()) {
    updateProbe(false);
    return false;
  }
  const now = Date.now();
  if (!force && lastProbe && now - lastProbe.at < PROBE_TTL_MS) {
    return lastProbe.reachable;
  }
  // Several screens ask at the same time: one ping answers them all.
  if (probeInFlight) return probeInFlight;

  probeInFlight = (async () => {
    try {
      let reachable = await pingOnce();
      // Was online: confirm before switching the whole app to offline mode.
      if (!reachable && lastKnownOnline() && isBrowserOnline()) {
        await wait(CONFIRM_DELAY_MS);
        reachable = await pingOnce();
      }
      updateProbe(reachable);
      return reachable;
    } finally {
      probeInFlight = null;
    }
  })();
  return probeInFlight;
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

/**
 * Outcome of an API request. A success proves the server is reachable. A failure
 * (timeout, connection reset) may be a one-off: it is confirmed by a ping before
 * the app is declared offline.
 */
export function reportNetworkResult(reachable: boolean): void {
  if (reachable) {
    updateProbe(true);
    return;
  }
  void probeServer(true);
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
const handleOnline = () => void probeServer(true);
const handleOffline = () => updateProbe(false);

/**
 * Subscribes to connectivity changes. The browser events and the periodic ping are
 * shared: ten subscribed components do not ping ten times.
 */
export function onConnectivityChange(listener: (online: boolean) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Periodic revalidation: an outage that happened without a browser event
    // (cable unplugged on the router side) must eventually be detected.
    pollTimer = setInterval(() => void probeServer(true), POLL_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
