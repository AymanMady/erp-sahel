/**
 * Registre des modules exposé au client ([FR-PLAT-3]).
 *
 * Le frontend compose sa navigation, ses formulaires produit et ses filtres à partir
 * de cette réponse : activer un module change l'interface sans redéploiement.
 */

import type { Express } from "express";
import { z } from "zod";

import { BUSINESS_PRESETS, BUSINESS_PRESET_CODES } from "@shared/modules-catalog";
import { MODULE_CODES } from "@shared/schema";
import { asyncHandler } from "../../shared/http/handler";
import { authOf, authorize, requireAuth } from "../auth/guards";
import { CORE_VERSION, pluginRegistry } from "./registry";

const moduleParamSchema = z.object({ code: z.enum(MODULE_CODES) });
const selectionSchema = z.union([
  z.object({ preset: z.enum(BUSINESS_PRESET_CODES as [string, ...string[]]) }),
  z.object({ modules: z.array(z.enum(MODULE_CODES)) }),
]);

export function registerPluginsRoutes(app: Express): void {
  app.get(
    "/api/platform/modules",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({
        coreVersion: CORE_VERSION,
        modules: await pluginRegistry.listForCompany(authOf(req).companyId),
      });
    })
  );

  app.post(
    "/api/platform/modules/:code/enable",
    requireAuth,
    authorize({ anyPermission: ["modules.manage"] }),
    asyncHandler(async (req, res) => {
      const { code } = moduleParamSchema.parse(req.params);
      await pluginRegistry.enableForCompany(authOf(req).companyId, code);
      res.json({
        success: true,
        modules: await pluginRegistry.listForCompany(authOf(req).companyId),
      });
    })
  );

  app.post(
    "/api/platform/modules/:code/disable",
    requireAuth,
    authorize({ anyPermission: ["modules.manage"] }),
    asyncHandler(async (req, res) => {
      const { code } = moduleParamSchema.parse(req.params);
      await pluginRegistry.disableForCompany(authOf(req).companyId, code);
      res.json({
        success: true,
        modules: await pluginRegistry.listForCompany(authOf(req).companyId),
      });
    })
  );

  /** Type d'activité (préréglage) ou sélection complète de modules, en une fois. */
  app.post(
    "/api/platform/modules/selection",
    requireAuth,
    authorize({ anyPermission: ["modules.manage"] }),
    asyncHandler(async (req, res) => {
      const body = selectionSchema.parse(req.body);
      const codes =
        "preset" in body
          ? (BUSINESS_PRESETS.find((preset) => preset.code === body.preset)?.modules ?? [])
          : body.modules;
      await pluginRegistry.applySelection(authOf(req).companyId, codes);
      res.json({
        success: true,
        modules: await pluginRegistry.listForCompany(authOf(req).companyId),
      });
    })
  );
}
