/** Routes de la comptabilité. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { AccountingController } from "./controller";

const canRead = authorize({ anyPermission: ["accounting.read"] });
const canWrite = authorize({ anyPermission: ["accounting.write"] });

export function registerAccountingRoutes(app: Express): void {
  const controller = new AccountingController();

  app.get("/api/accounting/accounts", requireAuth, canRead, asyncHandler(controller.listAccounts));
  app.post(
    "/api/accounting/accounts",
    requireAuth,
    canWrite,
    asyncHandler(controller.createAccount)
  );
  app.patch(
    "/api/accounting/accounts/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.updateAccount)
  );
  app.delete(
    "/api/accounting/accounts/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.archiveAccount)
  );

  app.get("/api/accounting/journals", requireAuth, canRead, asyncHandler(controller.listJournals));
  app.post(
    "/api/accounting/journals",
    requireAuth,
    canWrite,
    asyncHandler(controller.createJournal)
  );
  app.patch(
    "/api/accounting/journals/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.updateJournal)
  );

  app.get("/api/accounting/mappings", requireAuth, canRead, asyncHandler(controller.listMappings));
  app.put("/api/accounting/mappings", requireAuth, canWrite, asyncHandler(controller.setMapping));

  app.get("/api/accounting/entries", requireAuth, canRead, asyncHandler(controller.listEntries));
  app.post(
    "/api/accounting/entries",
    requireAuth,
    canWrite,
    asyncHandler(controller.createManualEntry)
  );
  app.get("/api/accounting/ledger", requireAuth, canRead, asyncHandler(controller.ledger));
  app.get("/api/accounting/balance", requireAuth, canRead, asyncHandler(controller.balance));

  app.get(
    "/api/accounting/fiscal-years",
    requireAuth,
    canRead,
    asyncHandler(controller.listFiscalYears)
  );
  app.post(
    "/api/accounting/fiscal-years",
    requireAuth,
    canWrite,
    asyncHandler(controller.createFiscalYear)
  );
  app.post(
    "/api/accounting/fiscal-years/:id/close",
    requireAuth,
    canWrite,
    asyncHandler(controller.closeFiscalYear)
  );
}
