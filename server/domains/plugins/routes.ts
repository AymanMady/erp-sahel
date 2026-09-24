/**
 * Modules exposés au client : activer un module change le menu et les écrans
 * immédiatement, sans redéploiement.
 */

import type { Express } from "express";
import { z } from "zod";

import { MODULE_PRESETS, MODULE_PRESET_CODES } from "@shared/modules-catalog";
import { MODULE_CODES } from "@shared/schema";
import { asyncHandler } from "../../shared/http/handler";
import { authOf, authorize, requireAuth } from "../auth/guards";
import { moduleRegistry } from "./registry";

const moduleParamSchema = z.object({ code: z.enum(MODULE_CODES) });
const selectionSchema = z.union([
  z.object({ preset: z.enum(MODULE_PRESET_CODES as [string, ...string[]]) }),
  z.object({ modules: z.array(z.enum(MODULE_CODES)) }),
]);

export function registerPluginsRoutes(app: Express): void {
  app.get(
    "/api/platform/modules",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({
        modules: await moduleRegistry.listForCompany(authOf(req).companyId),
      });
    })
  );

  app.post(
    "/api/platform/modules/:code/enable",
    requireAuth,
    authorize({ anyPermission: ["modules.manage"] }),
    asyncHandler(async (req, res) => {
      const { code } = moduleParamSchema.parse(req.params);
      await moduleRegistry.enableForCompany(authOf(req).companyId, code);
      res.json({
        success: true,
        modules: await moduleRegistry.listForCompany(authOf(req).companyId),
      });
    })
  );

  app.post(
    "/api/platform/modules/:code/disable",
    requireAuth,
    authorize({ anyPermission: ["modules.manage"] }),
    asyncHandler(async (req, res) => {
      const { code } = moduleParamSchema.parse(req.params);
      await moduleRegistry.disableForCompany(authOf(req).companyId, code);
      res.json({
        success: true,
        modules: await moduleRegistry.listForCompany(authOf(req).companyId),
      });
    })
  );

  /** Préréglage (simple, avec factures, complet) ou sélection complète, en une fois. */
  app.post(
    "/api/platform/modules/selection",
    requireAuth,
    authorize({ anyPermission: ["modules.manage"] }),
    asyncHandler(async (req, res) => {
      const body = selectionSchema.parse(req.body);
      const codes =
        "preset" in body
          ? (MODULE_PRESETS.find((preset) => preset.code === body.preset)?.modules ?? [])
          : body.modules;
      await moduleRegistry.applySelection(authOf(req).companyId, codes);
      res.json({
        success: true,
        modules: await moduleRegistry.listForCompany(authOf(req).companyId),
      });
    })
  );
}
