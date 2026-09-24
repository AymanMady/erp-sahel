/** Online/Offline synchronization routes. */

import type { Express } from "express";

import { syncRateLimit } from "../../middleware/rate-limit";
import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { SyncController } from "./controller";
// This import is deliberate and has a side effect: it registers the entity handlers
// with the dispatcher. Without it, the server would accept a `push` without knowing
// what to do with it.
import "./handlers";

export function registerSyncRoutes(app: Express): void {
  const controller = new SyncController();

  // Snapshot and push are available to any profile with POS access: it is the
  // point-of-sale device that works offline.
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
