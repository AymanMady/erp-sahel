/**
 * Settings of this workstation, kept by the desktop shell (`device.json`): the server
 * it talks to and the ticket printer.
 *
 * One installer serves every customer: the server is chosen at first launch, not at
 * build time. Loaded once before the first render (`main.tsx`), so that `apiUrl()`
 * stays synchronous everywhere else.
 */

import { clearSession } from "@/shared/auth/token-store";
import { offlineDb } from "@/shared/offline/db";
import { BUILD_SERVER_URL, isTauriDesktop, setApiBase, tauriCommand, tauriInvoke } from "./desktop";

export type PaperWidth = 58 | 80;

export interface PrinterSettings {
  /** `system`: the usual print window. `direct`: straight to the ticket printer. */
  mode: "system" | "direct";
  /** Direct mode: `tcp://192.168.1.50:9100`, `\\localhost\TICKET`, `/dev/usb/lp0`. */
  target: string;
  paperWidth: PaperWidth;
  /** Print the ticket as soon as the sale is paid. */
  autoPrint: boolean;
  /** Direct mode: open the cash drawer plugged into the printer. */
  openDrawer: boolean;
}

export const DEFAULT_PRINTER: PrinterSettings = {
  mode: "system",
  target: "",
  paperWidth: 80,
  autoPrint: false,
  openDrawer: false,
};

interface DeviceConfig {
  serverUrl: string | null;
  printer: PrinterSettings | null;
}

let config: DeviceConfig = { serverUrl: null, printer: null };

function normalizePrinter(value: unknown): PrinterSettings | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PrinterSettings>;
  return {
    mode: raw.mode === "direct" ? "direct" : "system",
    target: typeof raw.target === "string" ? raw.target : "",
    paperWidth: raw.paperWidth === 58 ? 58 : 80,
    autoPrint: raw.autoPrint === true,
    openDrawer: raw.openDrawer === true,
  };
}

/** Reads the workstation settings. Does nothing in a browser. */
export async function loadDeviceConfig(): Promise<void> {
  if (!isTauriDesktop()) return;
  const stored = await tauriInvoke<{ serverUrl?: string | null; printer?: unknown }>(
    "device_config_read"
  );
  config = {
    serverUrl: stored?.serverUrl || BUILD_SERVER_URL || null,
    printer: normalizePrinter(stored?.printer),
  };
  if (config.serverUrl) setApiBase(config.serverUrl);
}

async function writeConfig(next: DeviceConfig): Promise<void> {
  await tauriCommand<void>("device_config_write", { config: next });
  config = next;
}

/** Desktop shell that does not know its server yet: the first-launch screen is shown. */
export function needsServerSetup(): boolean {
  return isTauriDesktop() && !config.serverUrl;
}

/** Server of this workstation; `null` in a browser (same origin) or before setup. */
export function currentServerUrl(): string | null {
  return isTauriDesktop() ? config.serverUrl : null;
}

export class ServerAddressError extends Error {
  constructor(readonly reason: "invalid" | "unreachable" | "notErp") {
    super(reason);
    this.name = "ServerAddressError";
  }
}

/**
 * Cleans a typed address: adds `https://` when the scheme is missing, drops a trailing
 * `/` or a pasted `/api`. `erp.example.com` → `https://erp.example.com`.
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ServerAddressError("invalid");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ServerAddressError("invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ServerAddressError("invalid");
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  return `${url.origin}${path}`;
}

/** Makes sure the address answers, and that it is this application's server. */
export async function checkServer(origin: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${origin}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ServerAddressError("unreachable");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: some other website.
  }
  if (!response.ok || (body as { status?: unknown } | null)?.status !== "ok") {
    throw new ServerAddressError("notErp");
  }
}

/** Operations recorded on this workstation that the server has not accepted yet. */
export async function unsentOperationCount(): Promise<number> {
  let local = 0;
  try {
    local = await offlineDb.outbox.where("status").notEqual("synced").count();
  } catch {
    // Browser storage unavailable: SQLite still answers.
  }
  const durable = (await tauriInvoke<number>("offline_outbox_unsent_count")) ?? 0;
  return Math.max(local, durable);
}

export class UnsentDataError extends Error {
  constructor(readonly count: number) {
    super(`${count} unsent operation(s)`);
    this.name = "UnsentDataError";
  }
}

/**
 * Points the workstation at a server. When it replaces another one, everything kept
 * for the old server goes: its session, its copy of the data, its queue — another
 * server means another company. Refused while sales are still waiting to be sent:
 * they belong to the old server.
 *
 * The caller reloads the application afterwards, so that every screen starts again
 * from the new server.
 */
export async function saveServerUrl(origin: string): Promise<void> {
  const previous = config.serverUrl;
  if (previous && previous !== origin) {
    const unsent = await unsentOperationCount();
    if (unsent > 0) throw new UnsentDataError(unsent);
    clearSession();
    try {
      window.localStorage.removeItem("erp.pos.cart");
    } catch {
      // Storage unavailable: nothing kept there anyway.
    }
    await offlineDb.transaction(
      "rw",
      offlineDb.outbox,
      offlineDb.cache,
      offlineDb.meta,
      async () => {
        await offlineDb.outbox.clear();
        await offlineDb.cache.clear();
        await offlineDb.meta.clear();
      }
    );
    await tauriCommand<void>("offline_reset");
  }
  await writeConfig({ ...config, serverUrl: origin });
  setApiBase(origin);
}

export function printerSettings(): PrinterSettings {
  return config.printer ?? DEFAULT_PRINTER;
}

export async function savePrinterSettings(printer: PrinterSettings): Promise<void> {
  await writeConfig({ ...config, printer });
}
