/**
 * Desktop releases offered to the workstations of this server.
 *
 * The release manifest (`latest.json`, produced by the release workflow) is published
 * elsewhere — GitHub Releases, or any web space. The server does not host it: it
 * **relays** it. That way each installation decides when its workstations move to a
 * new release: set `DESKTOP_UPDATE_MANIFEST_URL` after updating the server itself, and
 * a workstation never runs a release newer than the server it talks to.
 */

import { z } from "zod";

import { compareVersions, parseVersion } from "@shared/app-version";
import { ServiceUnavailableError } from "../../shared/errors/app-error";
import { logger } from "../../shared/logging/logger";

/** Shape of a Tauri update manifest — only what is checked here; the rest is relayed. */
const manifestSchema = z
  .object({
    version: z.string().refine((value) => parseVersion(value) !== null),
    platforms: z.record(
      z.object({ url: z.string().url(), signature: z.string().min(1) }).passthrough()
    ),
  })
  .passthrough();

export type ReleaseManifest = z.infer<typeof manifestSchema>;

/** Workstations ask at startup and every few hours: one download serves them all. */
const CACHE_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

let cached: { url: string; at: number; manifest: ReleaseManifest } | null = null;

async function fetchManifest(url: string): Promise<ReleaseManifest> {
  if (cached && cached.url === url && Date.now() - cached.at < CACHE_MS) return cached.manifest;
  let raw: unknown;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    raw = await response.json();
  } catch (error) {
    logger.warn("Desktop release manifest unreachable", {
      url,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new ServiceUnavailableError(
      "The list of application updates cannot be read right now. Try again later.",
      "UPDATE_MANIFEST_UNAVAILABLE"
    );
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("Desktop release manifest is invalid", { url });
    throw new ServiceUnavailableError(
      "The list of application updates cannot be read right now. Try again later.",
      "UPDATE_MANIFEST_UNAVAILABLE"
    );
  }
  cached = { url, at: Date.now(), manifest: parsed.data };
  return parsed.data;
}

/** Test hook: forget the downloaded manifest. */
export function clearReleaseCache(): void {
  cached = null;
}

/**
 * Release to offer a workstation, or `null` when it is up to date — or when nothing is
 * published for its system (`target`: windows, linux, darwin; `arch`: x86_64, aarch64).
 */
export async function releaseFor(query: {
  target: string;
  arch: string;
  currentVersion: string;
}): Promise<ReleaseManifest | null> {
  const url = process.env.DESKTOP_UPDATE_MANIFEST_URL?.trim();
  if (!url) return null;
  const manifest = await fetchManifest(url);
  if (compareVersions(manifest.version, query.currentVersion) <= 0) return null;
  // Keys are `windows-x86_64`, or `windows-x86_64-nsis` when several installers exist.
  const platform = `${query.target}-${query.arch}`;
  const published = Object.keys(manifest.platforms).some(
    (key) => key === platform || key.startsWith(`${platform}-`)
  );
  return published ? manifest : null;
}

export type InstallerSystem = "windows" | "linux" | "macos";

export interface Installer {
  system: InstallerSystem;
  /** Processor: x86_64 (Intel, AMD) or aarch64 (ARM, Apple). */
  arch: string;
  /** File type, from its name: exe, msi, appimage, deb, rpm, dmg. */
  format: string;
  url: string;
}

/** Installer file types a person can download and open; update archives are left out. */
const INSTALLER_FORMATS: Record<string, InstallerSystem> = {
  exe: "windows",
  msi: "windows",
  appimage: "linux",
  deb: "linux",
  rpm: "linux",
  dmg: "macos",
};

/**
 * Installers of the release offered to this server's workstations, for the download
 * page — the same release the updater offers, so a new workstation starts where the
 * others are. Empty when no manifest is configured.
 */
export async function currentInstallers(): Promise<{
  version: string | null;
  installers: Installer[];
}> {
  const url = process.env.DESKTOP_UPDATE_MANIFEST_URL?.trim();
  if (!url) return { version: null, installers: [] };
  const manifest = await fetchManifest(url);
  const installers: Installer[] = [];
  for (const [key, platform] of Object.entries(manifest.platforms)) {
    const extension = new URL(platform.url).pathname.split(".").pop()?.toLowerCase() ?? "";
    const system = INSTALLER_FORMATS[extension];
    if (!system) continue;
    // Keys are `windows-x86_64` or `windows-x86_64-nsis`: the processor comes second.
    const arch = key.split("-")[1] ?? "x86_64";
    if (installers.some((installer) => installer.url === platform.url)) continue;
    installers.push({ system, arch, format: extension, url: platform.url });
  }
  return { version: manifest.version, installers };
}
