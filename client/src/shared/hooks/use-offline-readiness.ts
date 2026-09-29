import { useEffect, useState } from "react";

import {
  getOfflineReadiness,
  onOfflineReadinessChange,
  type OfflineReadiness,
} from "@/shared/offline/offline-prefetch";

/** Whether this device has downloaded everything it needs to work without network. */
export function useOfflineReadiness(): OfflineReadiness & { percent: number } {
  const [readiness, setReadiness] = useState<OfflineReadiness>(getOfflineReadiness);
  useEffect(() => onOfflineReadinessChange(setReadiness), []);
  // Never 100 % before the end: more work may still be discovered (document details).
  const percent =
    readiness.total > 0 ? Math.min(99, Math.floor((readiness.done / readiness.total) * 100)) : 0;
  return { ...readiness, percent };
}
