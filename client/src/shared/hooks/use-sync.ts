import { useEffect, useState } from "react";

import { useSession } from "@/shared/auth/session";
import { startLocalSession } from "@/shared/offline/local/local-sync";
import { initialiseOfflineReadiness, prefetchForOffline } from "@/shared/offline/offline-prefetch";
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
 *
 * On the desktop, the local database of the session's company is opened first
 * (offline-first mode, `offline/local/`): the first cycle already sends its queue.
 */
export function useSyncEngine(enabled: boolean): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);
  const companyId = useSession().company?.id ?? null;

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = onSyncStatusChange(setStatus);
    // After a successful synchronization, download what every page needs for offline
    // use: right away until the device is ready, then every 15 minutes at most.
    const syncThenPrefetch = async () => {
      const result = await runSync();
      if (result.state === "idle") void prefetchForOffline();
    };
    void initialiseOfflineReadiness();
    void (async () => {
      if (companyId) await startLocalSession(companyId);
      await initialiseSyncStatus();
      await syncThenPrefetch();
    })();

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
  }, [enabled, companyId]);

  return status;
}
