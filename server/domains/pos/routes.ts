/** Point-of-sale routes. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { PosController } from "./controller";

const canUse = authorize({ anyPermission: ["pos.use"] });
const canClose = authorize({ anyPermission: ["pos.session.close"] });
const canConfigure = authorize({ anyPermission: ["settings.write"] });

export function registerPosRoutes(app: Express): void {
  const controller = new PosController();

  app.get("/api/pos/registers", requireAuth, canUse, asyncHandler(controller.listRegisters));
  app.post(
    "/api/pos/registers",
    requireAuth,
    canConfigure,
    asyncHandler(controller.createRegister)
  );
  app.patch(
    "/api/pos/registers/:id",
    requireAuth,
    canConfigure,
    asyncHandler(controller.updateRegister)
  );
  app.delete(
    "/api/pos/registers/:id",
    requireAuth,
    canConfigure,
    asyncHandler(controller.archiveRegister)
  );

  app.get("/api/pos/sessions", requireAuth, canUse, asyncHandler(controller.listSessions));
  app.get(
    "/api/pos/sessions/current",
    requireAuth,
    canUse,
    asyncHandler(controller.currentSession)
  );
  app.get("/api/pos/sessions/:id", requireAuth, canUse, asyncHandler(controller.sessionSummary));
  app.post("/api/pos/sessions", requireAuth, canUse, asyncHandler(controller.openSession));
  app.post(
    "/api/pos/sessions/:id/close",
    requireAuth,
    canClose,
    asyncHandler(controller.closeSession)
  );

  app.post("/api/pos/tickets", requireAuth, canUse, asyncHandler(controller.createTicket));
}
