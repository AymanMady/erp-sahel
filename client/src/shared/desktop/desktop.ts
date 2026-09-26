/**
 * Bridge to the desktop shell (Tauri), without a hard dependency.
 *
 * The app is **the same** in the browser and in the shell: the Tauri module is only
 * imported if it is present at runtime. On the web, these functions return `null`
 * and the caller falls back to browser storage.
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    };
    __TAURI__?: unknown;
  }
}

/** Static build targeting the desktop shell (defined by Vite). */
declare const __DESKTOP_BUILD__: boolean;
/** Server origin of the desktop build; empty on the web (same-origin API). */
declare const __API_BASE_URL__: string;

/**
 * Absolute URL of an API path. The desktop shell is served from `tauri://localhost`,
 * so its calls must target the configured server; on the web the path stays relative.
 */
export function apiUrl(path: string): string {
  const base = typeof __API_BASE_URL__ !== "undefined" ? __API_BASE_URL__ : "";
  return base ? `${base}${path}` : path;
}

export function isDesktopBuild(): boolean {
  return typeof __DESKTOP_BUILD__ !== "undefined" && __DESKTOP_BUILD__;
}

export function isTauriDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);
}

/** Platform declared to the server: determines the content of the offline snapshot. */
export function devicePlatform(): "desktop" | "web" {
  return isTauriDesktop() ? "desktop" : "web";
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: InvokeFn | null | undefined;

async function loadInvoke(): Promise<InvokeFn | null> {
  if (cachedInvoke !== undefined) return cachedInvoke;
  if (!isTauriDesktop()) {
    cachedInvoke = null;
    return null;
  }
  // The shell always injects its IPC bridge: calling it directly avoids depending on
  // `@tauri-apps/api`, which a static build could not resolve at runtime anyway.
  const internals = window.__TAURI_INTERNALS__;
  cachedInvoke = internals?.invoke ? internals.invoke.bind(internals) : null;
  return cachedInvoke;
}

/**
 * Calls a Rust command. Returns `null` outside the desktop shell, or if the command
 * fails — the caller must always handle the "no desktop" case.
 */
export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.warn(`[desktop] command "${command}" failed`, error);
    return null;
  }
}
