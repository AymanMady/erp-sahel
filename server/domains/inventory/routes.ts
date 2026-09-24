/** Inventory routes. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { InventoryController } from "./controller";

const canRead = authorize({ anyPermission: ["inventory.read"] });
const canWrite = authorize({ anyPermission: ["inventory.write"] });
const canConfigure = authorize({ anyPermission: ["settings.write"] });

export function registerInventoryRoutes(app: Express): void {
  const controller = new InventoryController();

  app.get("/api/inventory/stock", requireAuth, canRead, asyncHandler(controller.listStock));
  app.get("/api/inventory/movements", requireAuth, canRead, asyncHandler(controller.listMovements));
  app.post(
    "/api/inventory/movements",
    requireAuth,
    canWrite,
    asyncHandler(controller.createMovement)
  );
  app.post("/api/inventory/transfer", requireAuth, canWrite, asyncHandler(controller.transfer));
  app.get("/api/inventory/valuation", requireAuth, canRead, asyncHandler(controller.valuation));
  app.get("/api/inventory/low-stock", requireAuth, canRead, asyncHandler(controller.lowStock));

  app.get("/api/warehouses", requireAuth, canRead, asyncHandler(controller.listWarehouses));
  app.post("/api/warehouses", requireAuth, canConfigure, asyncHandler(controller.createWarehouse));
  app.patch(
    "/api/warehouses/:id",
    requireAuth,
    canConfigure,
    asyncHandler(controller.updateWarehouse)
  );
  app.delete(
    "/api/warehouses/:id",
    requireAuth,
    canConfigure,
    asyncHandler(controller.archiveWarehouse)
  );
}
