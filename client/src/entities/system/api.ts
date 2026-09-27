/** API access for the technical screens of the platform super-administrator. */

import { apiRequest } from "@/shared/api/http";

export interface DatabaseOverview {
  server: {
    nodeVersion: string;
    environment: string;
    platform: string;
    uptimeSeconds: number;
    memoryBytes: number;
  };
  database: {
    name: string;
    version: string;
    sizeBytes: number;
    migrations: number | null;
    lastMigrationAt: string | null;
  };
  counts: { activeSessions: number; users: number; companies: number };
  tables: { name: string; rows: number; sizeBytes: number }[];
}

export type MaintenanceAction = "analyze" | "purge-expired" | "unlock-sign-in" | "end-all-sessions";

/** A whole database takes a while to read or write: well beyond the usual wait. */
const LONG_TIMEOUT_MS = 10 * 60_000;

export const systemApi = {
  overview: () => apiRequest<DatabaseOverview>("/api/system/overview"),
  /** Full backup, as a compressed file. */
  backup: () =>
    apiRequest<Blob>("/api/system/backup", { responseType: "blob", timeoutMs: LONG_TIMEOUT_MS }),
  /** Replaces the whole database with the file. */
  restore: (file: File) =>
    apiRequest<{ tables: number; rows: number }>("/api/system/restore", {
      method: "POST",
      // Always sent as bytes: a `.json` file must not be read as a JSON request.
      body: new Blob([file], { type: "application/octet-stream" }),
      queueOffline: false,
      timeoutMs: LONG_TIMEOUT_MS,
    }),
  maintenance: (action: MaintenanceAction) =>
    apiRequest<{ affected: number }>("/api/system/maintenance", {
      method: "POST",
      body: { action },
      queueOffline: false,
    }),
};
