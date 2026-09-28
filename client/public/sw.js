/**
 * ERP Sahel Service Worker.
 *
 * Single, deliberate role: **make the application shell available offline**
 * ([FR-SYNC-1]). It never caches API responses — offline business data lives in
 * IndexedDB, driven by the synchronization engine, the only one that knows what is
 * still valid and what must be uploaded.
 *
 * Strategies:
 *  - navigations: network first but for a few seconds at most, then the cached shell
 *    ("app shell") — also when the server answers with an error page (5xx);
 *  - hashed static assets: cache first, they are immutable;
 *  - API: never intercepted (the application has its own timeouts and offline reads).
 */

try {
  // Missing in development: the Service Worker is not registered there anyway.
  self.importScripts("/precache-manifest.js");
} catch {
  // No manifest: fall back to on-the-fly caching.
}

/**
 * Cache name, different for every build: `scripts/precache.ts` writes a build
 * identifier into the manifest. A new build therefore fills a new cache and `activate`
 * deletes the old ones — otherwise old files pile up on the phone. Bump the prefix by
 * hand only when the caching rules of this file change.
 */
const CACHE_PREFIX = "erp-sahel-";
const CACHE_VERSION = `${CACHE_PREFIX}v2-${typeof self.__ERP_BUILD === "string" ? self.__ERP_BUILD : "dev"}`;
const SHELL_URL = "/index.html";

/**
 * Beyond this delay a navigation is answered from the cached shell: on a 2G network
 * the application must open in a few seconds, not freeze for 30 s. A late network
 * answer still refreshes the cache for next time.
 */
const NETWORK_TIMEOUT_MS = 4500;

/** Minimal assets for an offline start. */
const BASE_PRECACHE = ["/", SHELL_URL, "/manifest.webmanifest", "/favicon.svg"];

/**
 * List of the chunks produced by the build, injected by `scripts/build.ts`.
 *
 * Without it, only pages **already visited** would be available offline: routes are
 * loaded on demand, and a chunk never downloaded is not cached. A cashier opening the
 * synchronization screen for the first time without network would get a blank page.
 */
function precacheList() {
  const generated = Array.isArray(self.__ERP_PRECACHE) ? self.__ERP_PRECACHE : [];
  return [...new Set([...BASE_PRECACHE, ...generated])];
}

/** Only a complete, same-origin answer may be cached — never an error page. */
function cacheable(response) {
  return response.ok && response.type === "basic";
}

/** Resolves to `null` after `ms`, so that a slow network can be given up on. */
function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Each asset is cached independently: a single missing file must not fail the
      // whole installation (`addAll` is all or nothing).
      await Promise.all(
        precacheList().map(async (url) => {
          try {
            const response = await fetch(new Request(url, { cache: "reload" }));
            if (cacheable(response)) await cache.put(url, response);
          } catch {
            // Asset unavailable at install time: it will be cached on first access.
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Every other ERP cache belongs to an older build.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "erp-skip-waiting") void self.skipWaiting();
});

/** Asks open tabs to start a synchronization. */
async function wakeClients() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: "erp-sync-request" });
}

// Background Sync when the browser supports it: the device can thus be woken up when
// the network returns even if the tab lost focus. The Service Worker does not replay
// operations itself (it has no access token): it wakes the tabs up.
self.addEventListener("sync", (event) => {
  if (event.tag === "erp-outbox") event.waitUntil(wakeClients());
});

self.addEventListener("online", () => void wakeClients());

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The API is never served from the cache: a stale invoice displayed as fresh would
  // be worse than an explicit network error.
  if (url.pathname.startsWith("/api/")) return;
  // Desktop installers: large files, downloaded once, never kept for offline use.
  if (url.pathname.startsWith("/downloads/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(SHELL_URL);
        const network = fetch(request).then(
          async (response) => {
            // A 5xx page must never replace the offline shell.
            if (cacheable(response)) {
              const cache = await caches.open(CACHE_VERSION);
              await cache.put(SHELL_URL, response.clone());
            }
            return response;
          },
          () => null
        );
        // Keeps the worker alive until a late answer has refreshed the cache.
        event.waitUntil(network);

        // No shell yet (first visit): wait for the network, however slow it is.
        if (!cached) {
          return (await network) ?? new Response("Offline", { status: 503, statusText: "Offline" });
        }
        const response = await Promise.race([network, timeout(NETWORK_TIMEOUT_MS)]);
        // Network cut, too slow, or server in trouble: the cached shell opens the
        // application, which then works with the data kept on the device.
        if (!response || response.status >= 500) return cached;
        return response;
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (cacheable(response)) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return Response.error();
      }
    })()
  );
});
