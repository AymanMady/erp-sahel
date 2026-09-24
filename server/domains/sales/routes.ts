/** Routes for quotes and sales orders. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { SalesController } from "./controller";

const canRead = authorize({ anyPermission: ["sales.read"] });
const canWrite = authorize({ anyPermission: ["sales.write"] });
const canInvoice = authorize({ anyPermission: ["invoicing.write"] });

export function registerSalesRoutes(app: Express): void {
  const controller = new SalesController();

  app.get("/api/quotes", requireAuth, canRead, asyncHandler(controller.listQuotes));
  app.get("/api/quotes/:id", requireAuth, canRead, asyncHandler(controller.getQuote));
  app.post("/api/quotes", requireAuth, canWrite, asyncHandler(controller.createQuote));
  app.patch("/api/quotes/:id", requireAuth, canWrite, asyncHandler(controller.updateQuote));
  app.patch(
    "/api/quotes/:id/status",
    requireAuth,
    canWrite,
    asyncHandler(controller.setQuoteStatus)
  );
  app.post("/api/quotes/:id/convert", requireAuth, canWrite, asyncHandler(controller.convertQuote));

  app.get("/api/sales-orders", requireAuth, canRead, asyncHandler(controller.listOrders));
  app.get("/api/sales-orders/:id", requireAuth, canRead, asyncHandler(controller.getOrder));
  app.post("/api/sales-orders", requireAuth, canWrite, asyncHandler(controller.createOrder));
  app.patch(
    "/api/sales-orders/:id/status",
    requireAuth,
    canWrite,
    asyncHandler(controller.setOrderStatus)
  );
  app.post(
    "/api/sales-orders/:id/invoice",
    requireAuth,
    canInvoice,
    asyncHandler(controller.invoiceOrder)
  );
}
