/**
 * Enregistrement du Service Worker.
 *
 * Il met en cache la coquille de l'application : c'est **ce qui permet d'ouvrir l'ERP
 * sans réseau** ([FR-SYNC-1]). Il ne rejoue jamais lui-même les opérations
 * authentifiées — il n'a pas accès au jeton — mais réveille les onglets ouverts pour
 * qu'ils relancent une synchronisation (`SYNC_STRATEGY.md` §11).
 */

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  // En développement, le Service Worker masquerait les rechargements à chaud de Vite.
  if (import.meta.env.DEV) return;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

    // Une nouvelle version prête : on l'active immédiatement plutôt que d'attendre la
    // fermeture de tous les onglets — un poste de caisse reste ouvert des journées.
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          installing.postMessage({ type: "erp-skip-waiting" });
        }
      });
    });
  } catch (error) {
    console.warn("[pwa] Service Worker non enregistré", error);
  }
}
