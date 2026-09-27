/**
 * Technical routes: database overview, backup, restore, maintenance.
 *
 * Reserved to the platform super-administrator — a company administrator gets a 403
 * like everybody else, whatever their roles.
 */

import express, { type Express } from "express";
import { z } from "zod";

import { todayInput } from "@shared/format";
import { ValidationError } from "../../shared/errors/app-error";
import { asyncHandler } from "../../shared/http/handler";
import { logger } from "../../shared/logging/logger";
import { authOf, requireAuth, requireSuperuser } from "../auth/guards";
import {
  MAINTENANCE_ACTIONS,
  databaseOverview,
  restoreBackup,
  runMaintenance,
  writeBackup,
} from "./database";

/** A backup is sent as the raw request body; a shop's database fits well below this. */
const backupUpload = express.raw({ type: () => true, limit: "500mb" });

const maintenanceSchema = z.object({ action: z.enum(MAINTENANCE_ACTIONS) });

export function registerSystemRoutes(app: Express): void {
  app.get(
    "/api/system/overview",
    requireAuth,
    requireSuperuser,
    asyncHandler(async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await databaseOverview());
    })
  );

  app.get(
    "/api/system/backup",
    requireAuth,
    requireSuperuser,
    asyncHandler(async (req, res) => {
      const fileName = `sauvegarde-erp-${todayInput()}.json.gz`;
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Cache-Control", "no-store");
      logger.info("Database backup requested", { username: authOf(req).username });
      try {
        await writeBackup(res);
      } catch (error) {
        // Headers are gone already: the only way left to report it is to cut the file.
        if (res.headersSent) {
          logger.error("Database backup failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          res.destroy();
          return;
        }
        throw error;
      }
    })
  );

  app.post(
    "/api/system/restore",
    requireAuth,
    requireSuperuser,
    backupUpload,
    asyncHandler(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new ValidationError("Choose a backup file.");
      }
      logger.warn("Database restore started", { username: authOf(req).username });
      const result = await restoreBackup(req.body);
      logger.warn("Database restored", result);
      res.json(result);
    })
  );

  app.post(
    "/api/system/maintenance",
    requireAuth,
    requireSuperuser,
    asyncHandler(async (req, res) => {
      const { action } = maintenanceSchema.parse(req.body);
      const auth = authOf(req);
      logger.info("Maintenance action", { action, username: auth.username });
      res.json(await runMaintenance(action, auth.userId));
    })
  );
}
