/** Payment routes. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { PaymentsController } from "./controller";

const canRead = authorize({ anyPermission: ["payments.read"] });
const canWrite = authorize({ anyPermission: ["payments.write"] });

export function registerPaymentsRoutes(app: Express): void {
  const controller = new PaymentsController();
  app.get("/api/payments", requireAuth, canRead, asyncHandler(controller.list));
  app.get("/api/payments/:id", requireAuth, canRead, asyncHandler(controller.get));
  app.post("/api/payments", requireAuth, canWrite, asyncHandler(controller.create));
}
