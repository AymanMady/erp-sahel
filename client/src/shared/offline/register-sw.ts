/**
 * Service Worker registration.
 *
 * It caches the application shell: this is **what allows opening the ERP without
 * network** ([FR-SYNC-1]). It never replays authenticated operations itself — it has
 * no access to the token — but wakes up open tabs so they start a synchronization
 * (`SYNC_STRATEGY.md` §11).
 */

import { isDesktopBuild } from "@/shared/desktop/desktop";

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  // In development, the Service Worker would hide Vite's hot reloads.
  if (import.meta.env.DEV) return;
  // The desktop shell embeds its assets: there is no shell to cache, and no `/sw.js`.
  if (isDesktopBuild()) return;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

    // A new version is ready: activate it immediately rather than waiting for every
    // tab to close — a POS terminal stays open for days.
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
    console.warn("[pwa] Service Worker not registered", error);
  }
}
