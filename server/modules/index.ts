/**
 * **Point de composition des modules** — le seul fichier du serveur qui connaisse
 * à la fois le noyau et les plugins.
 *
 * Partout ailleurs, la dépendance est strictement `plugin → core` ([BR-17],
 * [FR-PLUG-3]). Retirer un module revient à retirer sa ligne ici : aucun autre fichier
 * du noyau ne le nomme.
 */

import type { Express } from "express";

import { pluginRegistry } from "../domains/plugins/registry";
import { logger } from "../shared/logging/logger";
import { autoPartsPlugin } from "./auto-parts/plugin";
import { registerAutoPartsRoutes } from "./auto-parts/routes";
import { clothingPlugin } from "./clothing/plugin";
import { registerClothingRoutes } from "./clothing/routes";
import { marketPlugin } from "./market/plugin";
import { registerMarketRoutes } from "./market/routes";

/** Enregistre les modules dans le registre et valide leurs dépendances. */
export function registerPlugins(): void {
  if (pluginRegistry.list().length > 0) return;
  pluginRegistry.register(autoPartsPlugin);
  pluginRegistry.register(clothingPlugin);
  pluginRegistry.register(marketPlugin);
  pluginRegistry.validate();
  logger.info("Modules métier enregistrés", {
    modules: pluginRegistry.list().map((plugin) => plugin.meta.code),
  });
}

/** Monte les routes HTTP propres à chaque module. */
export function registerModuleRoutes(app: Express): void {
  registerAutoPartsRoutes(app);
  registerClothingRoutes(app);
  registerMarketRoutes(app);
}
