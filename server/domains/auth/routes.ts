/** Registers the authentication routes. */

import type { Express } from "express";

import { authRateLimit } from "../../middleware/rate-limit";
import { asyncHandler } from "../../shared/http/handler";
import { AuthController } from "./controller";
import { requireAuth } from "./guards";

export function registerAuthRoutes(app: Express): void {
  const controller = new AuthController();

  app.post("/api/auth/login", authRateLimit, asyncHandler(controller.login));
  app.post("/api/auth/refresh", authRateLimit, asyncHandler(controller.refresh));
  app.post("/api/auth/logout", asyncHandler(controller.logout));
  app.get("/api/auth/me", requireAuth, asyncHandler(controller.me));
  app.post("/api/auth/switch-company", requireAuth, asyncHandler(controller.switchCompany));
  app.post("/api/auth/change-password", requireAuth, asyncHandler(controller.changePassword));
}
