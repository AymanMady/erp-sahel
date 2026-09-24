/**
 * Bridge to the desktop shell (Tauri), without a hard dependency.
 *
 * The app is **the same** in the browser and in the shell: the Tauri module is only
 * imported if it is present at runtime. On the web, these functions return `null`
 * and the caller falls back to browser storage.
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

/** Static build targeting the desktop shell (defined by Vite). */
declare const __DESKTOP_BUILD__: boolean;

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
  try {
    // Specifier built at runtime: the Tauri package is not a dependency of the
    // web build, so it must not be resolved at compile time.
    const specifier = ["@tauri-apps", "api", "core"].join("/");
    const module = (await import(/* @vite-ignore */ specifier)) as { invoke: InvokeFn };
    cachedInvoke = module.invoke;
  } catch {
    cachedInvoke = null;
  }
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
