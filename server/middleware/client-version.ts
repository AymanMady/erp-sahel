/**
 * Refuses desktop workstations older than the oldest supported release.
 *
 * Such a workstation keeps working on its own data: the client treats the refusal like
 * a missing network — reads come from the local copy, sales go to the local queue — and
 * offers the update. Nothing it sends is lost, and nothing in an outdated format
 * reaches the database.
 *
 * Browsers are not checked: the web application always comes from this server, and its
 * Service Worker switches to the new release by itself.
 */

import type { NextFunction, Request, Response } from "express";

import {
  LEGACY_DESKTOP_VERSION,
  MIN_DESKTOP_VERSION,
  UPGRADE_REQUIRED_CODE,
  compareVersions,
  newestVersion,
} from "@shared/app-version";
import { AppError } from "../shared/errors/app-error";

/** Oldest accepted release: the code's own floor, raised by the configuration if set. */
export function minimumDesktopVersion(): string {
  return newestVersion(MIN_DESKTOP_VERSION, process.env.DESKTOP_MIN_VERSION);
}

export class UpgradeRequiredError extends AppError {
  constructor(minVersion: string) {
    super(
      "This version of the application is too old for the server. Install the update to continue sending your data.",
      426,
      UPGRADE_REQUIRED_CODE,
      { minVersion }
    );
  }
}

/**
 * Paths that stay open to an outdated workstation: the health probe (otherwise it would
 * believe it is offline) and the update endpoint (its only way out).
 */
const ALWAYS_OPEN = [/^\/health(\/|$)/, /^\/desktop\//];

export function clientVersionGate(req: Request, _res: Response, next: NextFunction): void {
  if (req.headers["x-device-platform"] !== "desktop") {
    next();
    return;
  }
  if (ALWAYS_OPEN.some((pattern) => pattern.test(req.path))) {
    next();
    return;
  }
  const header = req.headers["x-app-version"];
  const version = typeof header === "string" && header ? header : LEGACY_DESKTOP_VERSION;
  const minimum = minimumDesktopVersion();
  if (compareVersions(version, minimum) < 0) {
    next(new UpgradeRequiredError(minimum));
    return;
  }
  next();
}
