/** Customer invoicing routes. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { InvoicingController } from "./controller";

const canRead = authorize({ anyPermission: ["invoicing.read"] });
const canWrite = authorize({ anyPermission: ["invoicing.write"] });
const canCancel = authorize({ anyPermission: ["invoicing.cancel"] });

export function registerInvoicingRoutes(app: Express): void {
  const controller = new InvoicingController();

  app.get("/api/invoices", requireAuth, canRead, asyncHandler(controller.list));
  app.get("/api/credit-notes", requireAuth, canRead, asyncHandler(controller.listCreditNotes));
  app.get("/api/credit-notes/:id", requireAuth, canRead, asyncHandler(controller.getCreditNote));
  app.post("/api/credit-notes", requireAuth, canCancel, asyncHandler(controller.createCreditNote));

  app.get("/api/invoices/:id", requireAuth, canRead, asyncHandler(controller.get));
  app.post("/api/invoices", requireAuth, canWrite, asyncHandler(controller.create));
  app.patch("/api/invoices/:id", requireAuth, canWrite, asyncHandler(controller.update));
  app.post("/api/invoices/:id/validate", requireAuth, canWrite, asyncHandler(controller.validate));
  app.delete("/api/invoices/:id", requireAuth, canWrite, asyncHandler(controller.cancelDraft));
}
