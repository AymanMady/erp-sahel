import { useEffect, useState } from "react";

import { prefetchForOffline } from "@/shared/offline/offline-prefetch";
import {
  getSyncStatus,
  initialiseSyncStatus,
  onSyncStatusChange,
  runSync,
  type SyncStatus,
} from "@/shared/offline/sync-engine";

/** Retry interval: a device that stays open always ends up resynchronizing. */
const PERIODIC_SYNC_MS = 60_000;

/**
 * Drives background synchronization.
 *
 * Combined triggers, because none is enough on its own:
 *  - connectivity restored (`online`) — the nominal case;
 *  - focus regained / tab visible again — after sleep;
 *  - timer — safety net if no event is emitted;
 *  - Service Worker message — resume triggered outside the tab.
 */
export function useSyncEngine(enabled: boolean): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = onSyncStatusChange(setStatus);
    // After a successful synchronization, prefetch pages for offline use
    // (limited to one pass per half hour by `prefetchForOffline`).
    const syncThenPrefetch = async () => {
      const result = await runSync();
      if (result.state === "idle") void prefetchForOffline();
    };
    void initialiseSyncStatus().then(syncThenPrefetch);

    const trigger = () => void syncThenPrefetch();
    const onVisible = () => {
      if (document.visibilityState === "visible") trigger();
    };

    window.addEventListener("online", trigger);
    window.addEventListener("focus", trigger);
    document.addEventListener("visibilitychange", onVisible);

    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "erp-sync-request") trigger();
    };
    navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);

    const timer = window.setInterval(trigger, PERIODIC_SYNC_MS);

    return () => {
      unsubscribe();
      window.removeEventListener("online", trigger);
      window.removeEventListener("focus", trigger);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
      window.clearInterval(timer);
    };
  }, [enabled]);

  return status;
}
