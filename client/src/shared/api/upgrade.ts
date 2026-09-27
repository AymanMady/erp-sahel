/**
 * "This release is too old for the server" (HTTP 426), shared by every screen.
 *
 * The HTTP client raises it; the update banner listens. While it is set, the
 * application keeps working on its local copy and queue, as without network.
 */

import { useSyncExternalStore } from "react";

export interface UpgradeRequirement {
  /** Oldest release the server accepts. */
  minVersion: string | null;
}

let requirement: UpgradeRequirement | null = null;
const listeners = new Set<() => void>();

export function notifyUpgradeRequired(details: unknown): void {
  const minVersion = (details as { minVersion?: unknown } | null)?.minVersion;
  if (requirement) return;
  requirement = { minVersion: typeof minVersion === "string" ? minVersion : null };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpgradeRequirement(): UpgradeRequirement | null {
  return useSyncExternalStore(subscribe, () => requirement);
}
