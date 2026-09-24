/**
 * ERP Sahel Service Worker.
 *
 * Single, deliberate role: **make the application shell available offline**
 * ([FR-SYNC-1]). It never caches API responses — offline business data lives in
 * IndexedDB, driven by the synchronization engine, the only one that knows what is
 * still valid and what must be uploaded.
 *
 * Strategies:
 *  - navigations: network first, fall back to the cached shell ("app shell");
 *  - hashed static assets: cache first, they are immutable;
 *  - API: never intercepted.
 */

const CACHE_VERSION = "erp-sahel-v1";
const SHELL_URL = "/index.html";

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

try {
  // Missing in development: the Service Worker is not registered there anyway.
  self.importScripts("/precache-manifest.js");
} catch {
  // No manifest: fall back to on-the-fly caching.
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
            if (response.ok) await cache.put(url, response);
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
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
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

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(SHELL_URL, response.clone());
          return response;
        } catch {
          const cached = await caches.match(SHELL_URL);
          return cached ?? new Response("Offline", { status: 503, statusText: "Offline" });
        }
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
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return cached ?? Response.error();
      }
    })()
  );
});
