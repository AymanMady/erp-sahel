/**
 * Updates of the desktop application.
 *
 * The workstation asks **its own server** (`/api/desktop/update/...`), which relays the
 * release it has chosen for its workstations. The shell downloads the package, checks
 * its signature against the key built into the application, installs it and restarts.
 * Sales not yet sent stay in the local database, which an update does not touch.
 */

import { useSyncExternalStore } from "react";

import { currentServerUrl } from "./device-config";
import { isTauriDesktop, tauriCommand } from "./desktop";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export interface UpdateState {
  status: "idle" | "checking" | "upToDate" | "available" | "installing" | "error";
  info: UpdateInfo | null;
  /** Technical detail of the last failure, shown under the plain message. */
  error: string | null;
  checkedAt: number | null;
}

/** Background checks: at startup (once the app has settled) then every few hours. */
const FIRST_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

let state: UpdateState = { status: "idle", info: null, error: null, checkedAt: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppUpdate(): UpdateState {
  return useSyncExternalStore(subscribe, () => state);
}

/** True where updates can be installed from the application itself. */
export function canSelfUpdate(): boolean {
  return isTauriDesktop() && Boolean(currentServerUrl());
}

/**
 * Asks the server whether a newer release exists. `silent`: a background check —
 * a failure (no network, server not configured) leaves the previous state alone.
 */
export async function checkForUpdate(options: { silent?: boolean } = {}): Promise<UpdateState> {
  const server = currentServerUrl();
  if (!isTauriDesktop() || !server) return state;
  if (state.status === "checking" || state.status === "installing") return state;
  const previous = state;
  setState({ status: "checking", error: null });
  try {
    // The shell fills in the placeholders with its system, processor and release.
    const endpoint = `${server}/api/desktop/update/{{target}}/{{arch}}/{{current_version}}`;
    const info = await tauriCommand<UpdateInfo | null>("app_update_check", { endpoint });
    setState({ status: info ? "available" : "upToDate", info, checkedAt: Date.now() });
  } catch (error) {
    if (options.silent) setState({ ...previous });
    else setState({ status: "error", error: String((error as Error).message ?? error) });
  }
  return state;
}

/** Downloads and installs the release found by the last check; the app then restarts. */
export async function installUpdate(): Promise<void> {
  setState({ status: "installing", error: null });
  try {
    await tauriCommand<void>("app_update_install");
  } catch (error) {
    setState({ status: "error", error: String((error as Error).message ?? error) });
  }
}

let started = false;

/** Starts the background checks, once per application run. */
export function startUpdateChecks(): void {
  if (started || !canSelfUpdate()) return;
  started = true;
  setTimeout(() => void checkForUpdate({ silent: true }), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkForUpdate({ silent: true }), CHECK_INTERVAL_MS);
}
