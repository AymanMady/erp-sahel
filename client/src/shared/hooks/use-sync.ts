import { useEffect, useState } from "react";

import {
  getSyncStatus,
  initialiseSyncStatus,
  onSyncStatusChange,
  runSync,
  type SyncStatus,
} from "@/shared/offline/sync-engine";

/** Intervalle de reprise : un poste qui reste ouvert finit toujours par se resynchroniser. */
const PERIODIC_SYNC_MS = 60_000;

/**
 * Pilote la synchronisation en arrière-plan.
 *
 * Déclencheurs cumulés, parce qu'aucun ne suffit seul :
 *  - retour de connectivité (`online`) — le cas nominal ;
 *  - reprise de focus / onglet redevenu visible — après une mise en veille ;
 *  - minuteur — filet de sécurité si aucun événement n'est émis ;
 *  - message du Service Worker — reprise déclenchée hors de l'onglet.
 */
export function useSyncEngine(enabled: boolean): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = onSyncStatusChange(setStatus);
    void initialiseSyncStatus().then(() => runSync());

    const trigger = () => void runSync();
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
