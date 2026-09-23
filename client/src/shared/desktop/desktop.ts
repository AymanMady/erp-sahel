/**
 * Pont vers la coquille desktop (Tauri), sans dépendance dure.
 *
 * L'application est **la même** en navigateur et dans la coquille : on n'importe le
 * module Tauri que s'il est présent à l'exécution. En web, ces fonctions renvoient
 * `null` et l'appelant retombe sur le stockage navigateur.
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

/** Build statique destiné à la coquille desktop (défini par Vite). */
declare const __DESKTOP_BUILD__: boolean;

export function isDesktopBuild(): boolean {
  return typeof __DESKTOP_BUILD__ !== "undefined" && __DESKTOP_BUILD__;
}

export function isTauriDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);
}

/** Plateforme déclarée au serveur : conditionne le contenu de l'instantané hors-ligne. */
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
    // Spécificateur construit à l'exécution : le paquet Tauri n'est pas une
    // dépendance du build web, et ne doit donc pas être résolu à la compilation.
    const specifier = ["@tauri-apps", "api", "core"].join("/");
    const module = (await import(/* @vite-ignore */ specifier)) as { invoke: InvokeFn };
    cachedInvoke = module.invoke;
  } catch {
    cachedInvoke = null;
  }
  return cachedInvoke;
}

/**
 * Appelle une commande Rust. Renvoie `null` hors coquille desktop, ou si la commande
 * échoue — l'appelant doit toujours prévoir le cas « pas de desktop ».
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
    console.warn(`[desktop] commande « ${command} » en échec`, error);
    return null;
  }
}
