/**
 * Desktop application routes.
 *
 * Public: the updater of a workstation asks before anyone has signed in — and an
 * outdated workstation, refused everywhere else, must still reach it.
 */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { releaseFor } from "./releases";

export function registerDesktopRoutes(app: Express): void {
  /**
   * Update check, in the format the Tauri updater expects: 204 when there is nothing
   * to install, otherwise the release manifest.
   */
  app.get(
    "/api/desktop/update/:target/:arch/:currentVersion",
    asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const release = await releaseFor({
        target: String(req.params.target),
        arch: String(req.params.arch),
        currentVersion: String(req.params.currentVersion),
      });
      if (!release) {
        res.status(204).end();
        return;
      }
      res.json(release);
    })
  );
}
