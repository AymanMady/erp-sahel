import { useEffect, useState } from "react";

import {
  getBootstrapState,
  onBootstrapProgress,
  type BootstrapState,
} from "@/shared/offline/local/replication";

/**
 * First download of the local database (offline-first desktop): how far it is.
 * Never 100 % before the end: the last page may still be on its way.
 */
export function useLocalBootstrap(): BootstrapState & { percent: number } {
  const [state, setState] = useState<BootstrapState>(getBootstrapState);
  useEffect(() => onBootstrapProgress(setState), []);
  const percent = state.total > 0 ? Math.min(99, Math.floor((state.rows / state.total) * 100)) : 0;
  return { ...state, percent };
}
