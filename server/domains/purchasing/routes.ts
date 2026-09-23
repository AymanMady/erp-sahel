/** Routes des achats. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { PurchasingController } from "./controller";

const canRead = authorize({ anyPermission: ["purchasing.read"] });
const canWrite = authorize({ anyPermission: ["purchasing.write"] });

export function registerPurchasingRoutes(app: Express): void {
  const controller = new PurchasingController();

  app.get("/api/purchase-orders", requireAuth, canRead, asyncHandler(controller.listOrders));
  app.get("/api/purchase-orders/:id", requireAuth, canRead, asyncHandler(controller.getOrder));
  app.post("/api/purchase-orders", requireAuth, canWrite, asyncHandler(controller.createOrder));
  app.patch(
    "/api/purchase-orders/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.updateOrder)
  );
  app.patch(
    "/api/purchase-orders/:id/status",
    requireAuth,
    canWrite,
    asyncHandler(controller.setOrderStatus)
  );

  app.get("/api/goods-receipts", requireAuth, canRead, asyncHandler(controller.listReceipts));
  app.get("/api/goods-receipts/:id", requireAuth, canRead, asyncHandler(controller.getReceipt));
  app.post("/api/goods-receipts", requireAuth, canWrite, asyncHandler(controller.createReceipt));

  app.get(
    "/api/supplier-invoices",
    requireAuth,
    canRead,
    asyncHandler(controller.listSupplierInvoices)
  );
  app.post(
    "/api/supplier-invoices",
    requireAuth,
    canWrite,
    asyncHandler(controller.createSupplierInvoice)
  );
}
