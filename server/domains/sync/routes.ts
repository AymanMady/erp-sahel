/** Online/Offline synchronization routes. */

import type { Express, RequestHandler } from "express";

import { syncRateLimit } from "../../middleware/rate-limit";
import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth, requireSuperuser } from "../auth/guards";
import { SyncController } from "./controller";
// This import is deliberate and has a side effect: it registers the entity handlers
// with the dispatcher. Without it, the server would accept a `push` without knowing
// what to do with it.
import "./handlers";

export function registerSyncRoutes(app: Express): void {
  const controller = new SyncController();

  // Snapshot and delta: the reference data a device shows without network. Push: each
  // operation is checked against the rights of the online route it replays.
  const canReadReference = authorize({
    anyPermission: ["pos.use", "catalog.read", "invoicing.write"],
  });
  app.get(
    "/api/sync/snapshot",
    requireAuth,
    canReadReference,
    syncRateLimit,
    asyncHandler(controller.snapshot)
  );
  // The cursor pull filters per entity itself; the former delta keeps its guard.
  const canPull: RequestHandler = (req, res, next) =>
    req.query.cursor !== undefined ? next() : canReadReference(req, res, next);
  app.get("/api/sync/pull", requireAuth, canPull, syncRateLimit, asyncHandler(controller.pull));
  app.post("/api/sync/push", requireAuth, syncRateLimit, asyncHandler(controller.push));
  // Offline-first workstation: rights are checked per entity (`entities.ts`), a person
  // only receives what the screens would show them.
  app.post(
    "/api/sync/bootstrap",
    requireAuth,
    syncRateLimit,
    asyncHandler(controller.bootstrapStart)
  );
  app.get(
    "/api/sync/bootstrap/:entity",
    requireAuth,
    syncRateLimit,
    asyncHandler(controller.bootstrapPage)
  );
  // Monitoring (devices, journal): the technical screen of the super-administrator.
  app.patch(
    "/api/sync/devices/:id",
    requireAuth,
    requireSuperuser,
    asyncHandler(controller.setDeviceOfflineLogin)
  );

  app.get("/api/sync/status", requireAuth, requireSuperuser, asyncHandler(controller.status));
  app.get("/api/sync/journal", requireAuth, requireSuperuser, asyncHandler(controller.journal));
}
