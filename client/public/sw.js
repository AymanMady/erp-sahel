/**
 * Service Worker d'ERP Sahel.
 *
 * Rôle unique et assumé : **rendre la coquille de l'application disponible hors ligne**
 * ([FR-SYNC-1]). Il ne met jamais en cache les réponses de l'API — la donnée métier
 * hors-ligne vit dans IndexedDB, pilotée par le moteur de synchronisation, seul à
 * savoir ce qui est encore valide et ce qui doit être remonté.
 *
 * Stratégies :
 *  - navigations : réseau d'abord, repli sur la coquille en cache (« app shell ») ;
 *  - ressources statiques hachées : cache d'abord, elles sont immuables ;
 *  - API : jamais interceptée.
 */

const CACHE_VERSION = "erp-sahel-v1";
const SHELL_URL = "/index.html";

/** Ressources minimales pour un démarrage hors ligne. */
const BASE_PRECACHE = ["/", SHELL_URL, "/manifest.webmanifest", "/favicon.svg"];

/**
 * Liste des fragments produits par le build, injectée par `scripts/build.ts`.
 *
 * Sans elle, seules les pages **déjà visitées** seraient disponibles hors ligne : les
 * routes sont chargées à la demande, et un fragment jamais téléchargé n'est pas en cache.
 * Un caissier qui ouvre l'écran de synchronisation pour la première fois sans réseau
 * tomberait sur une page blanche.
 */
function precacheList() {
  const generated = Array.isArray(self.__ERP_PRECACHE) ? self.__ERP_PRECACHE : [];
  return [...new Set([...BASE_PRECACHE, ...generated])];
}

try {
  // Absent en développement : le Service Worker n'y est de toute façon pas enregistré.
  self.importScripts("/precache-manifest.js");
} catch {
  // Pas de manifeste : on se rabat sur la mise en cache à la volée.
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Chaque ressource est mise en cache indépendamment : un seul fichier manquant
      // ne doit pas faire échouer l'installation entière (`addAll` est tout ou rien).
      await Promise.all(
        precacheList().map(async (url) => {
          try {
            const response = await fetch(new Request(url, { cache: "reload" }));
            if (response.ok) await cache.put(url, response);
          } catch {
            // Ressource indisponible à l'installation : elle sera cachée au premier accès.
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

/** Demande aux onglets ouverts de relancer une synchronisation. */
async function wakeClients() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: "erp-sync-request" });
}

// Background Sync quand le navigateur le supporte : le poste peut ainsi être réveillé
// au retour du réseau même si l'onglet a perdu le focus. Le Service Worker ne rejoue
// pas les opérations lui-même (il n'a pas le jeton d'accès) : il réveille les onglets.
self.addEventListener("sync", (event) => {
  if (event.tag === "erp-outbox") event.waitUntil(wakeClients());
});

self.addEventListener("online", () => void wakeClients());

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // L'API n'est jamais servie depuis le cache : une facture périmée affichée comme
  // fraîche serait pire qu'une erreur réseau explicite.
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
          return cached ?? new Response("Hors ligne", { status: 503, statusText: "Hors ligne" });
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
