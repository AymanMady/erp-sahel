/**
 * Versions of the desktop application — shared between client and server.
 *
 * A workstation may stay closed for weeks, then come back with an old release and a
 * queue of sales to send. The server must be able to say "this release is too old,
 * update it first" rather than receive data in a format it no longer reads.
 */

/**
 * Oldest desktop release this code base still accepts.
 *
 * Raise it **in the same change** as anything an older workstation would get wrong:
 * a synchronization payload that changed shape, an endpoint removed or renamed, a
 * business rule the client computes locally (totals, numbering). The server
 * configuration (`DESKTOP_MIN_VERSION`) can only raise it further, never lower it.
 */
export const MIN_DESKTOP_VERSION = "1.0.0";

/**
 * Release of the workstations that predate version checks: they send no version at
 * all. They were all published as 1.0.0.
 */
export const LEGACY_DESKTOP_VERSION = "1.0.0";

/** Header carrying the release of the calling application. */
export const APP_VERSION_HEADER = "X-App-Version";

/** Error code of a request refused because the application is too old. */
export const UPGRADE_REQUIRED_CODE = "CLIENT_UPGRADE_REQUIRED";

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/** `"1.4.2"` → `[1, 4, 2]`; `null` if it is not a version number. */
export function parseVersion(value: string | null | undefined): [number, number, number] | null {
  const match = VERSION_PATTERN.exec((value ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Negative if `a` is older than `b`, positive if newer, 0 if equal. Pre-release
 * suffixes are ignored: `1.2.0-beta` counts as `1.2.0`. An unreadable version counts as
 * the oldest possible.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? [0, 0, 0];
  const right = parseVersion(b) ?? [0, 0, 0];
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** The newer of the two versions — an invalid one is ignored. */
export function newestVersion(a: string, b: string | null | undefined): string {
  if (!b || !parseVersion(b)) return a;
  return compareVersions(b, a) > 0 ? b : a;
}
