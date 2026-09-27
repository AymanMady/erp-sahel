/** API access for synchronization monitoring. */

import { api } from "@/shared/api/http";
import type { SyncOperation } from "@/entities/types";

export interface SyncDevice {
  id: string;
  deviceId: string;
  label: string;
  platform: string;
  lastSnapshotAt: string | null;
  lastPushAt: string | null;
  pendingHint: number;
  /** Desktop only: an administrator allowed signing in without internet on it. */
  offlineLoginAllowed?: boolean;
}

export const syncApi = {
  status: () =>
    api.get<{
      stats: { created: number; duplicates: number; errors: number; deferred: number };
      devices: SyncDevice[];
    }>("/api/sync/status"),
  journal: () => api.get<SyncOperation[]>("/api/sync/journal"),
  setDeviceOfflineLogin: (id: string, offlineLoginAllowed: boolean) =>
    api.patch<SyncDevice>(`/api/sync/devices/${id}`, { offlineLoginAllowed }),
};
