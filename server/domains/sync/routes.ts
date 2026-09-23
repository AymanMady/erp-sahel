/** Routes de synchronisation Online/Offline. */

import type { Express } from "express";

import { syncRateLimit } from "../../middleware/rate-limit";
import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { SyncController } from "./controller";
// L'import est volontaire et a un effet de bord : il enregistre les handlers
// d'entités auprès du répartiteur. Sans lui, le serveur accepterait un `push`
// sans savoir quoi en faire.
import "./handlers";

export function registerSyncRoutes(app: Express): void {
  const controller = new SyncController();

  // L'instantané et le push sont utilisables par tout profil disposant du POS :
  // c'est le poste de vente qui travaille hors-ligne.
  app.get("/api/sync/snapshot", requireAuth, syncRateLimit, asyncHandler(controller.snapshot));
  app.get("/api/sync/pull", requireAuth, syncRateLimit, asyncHandler(controller.pull));
  app.post("/api/sync/push", requireAuth, syncRateLimit, asyncHandler(controller.push));

  app.get(
    "/api/sync/status",
    requireAuth,
    authorize({ anyPermission: ["settings.read", "pos.use"] }),
    asyncHandler(controller.status)
  );
  app.get(
    "/api/sync/journal",
    requireAuth,
    authorize({ anyPermission: ["audit.read", "settings.read"] }),
    asyncHandler(controller.journal)
  );
}
