/** Party routes. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { PartiesController } from "./controller";

const canRead = authorize({ anyPermission: ["parties.read"] });
const canWrite = authorize({ anyPermission: ["parties.write"] });

export function registerPartiesRoutes(app: Express): void {
  const controller = new PartiesController();

  app.get("/api/parties", requireAuth, canRead, asyncHandler(controller.list));
  app.get("/api/parties/:id", requireAuth, canRead, asyncHandler(controller.get));
  app.post("/api/parties", requireAuth, canWrite, asyncHandler(controller.create));
  app.patch("/api/parties/:id", requireAuth, canWrite, asyncHandler(controller.update));
  app.delete("/api/parties/:id", requireAuth, canWrite, asyncHandler(controller.archive));

  app.get("/api/parties/:id/contacts", requireAuth, canRead, asyncHandler(controller.listContacts));
  app.post(
    "/api/parties/:id/contacts",
    requireAuth,
    canWrite,
    asyncHandler(controller.createContact)
  );
  app.patch(
    "/api/parties/contacts/:contactId",
    requireAuth,
    canWrite,
    asyncHandler(controller.updateContact)
  );
  app.delete(
    "/api/parties/contacts/:contactId",
    requireAuth,
    canWrite,
    asyncHandler(controller.archiveContact)
  );

  app.get(
    "/api/parties/:id/addresses",
    requireAuth,
    canRead,
    asyncHandler(controller.listAddresses)
  );
  app.post(
    "/api/parties/:id/addresses",
    requireAuth,
    canWrite,
    asyncHandler(controller.createAddress)
  );
  app.patch(
    "/api/parties/addresses/:addressId",
    requireAuth,
    canWrite,
    asyncHandler(controller.updateAddress)
  );
  app.delete(
    "/api/parties/addresses/:addressId",
    requireAuth,
    canWrite,
    asyncHandler(controller.archiveAddress)
  );
}
