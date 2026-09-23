/** Routes de la trésorerie. */

import type { Express } from "express";

import { asyncHandler } from "../../shared/http/handler";
import { authorize, requireAuth } from "../auth/guards";
import { BankingController } from "./controller";

const canRead = authorize({ anyPermission: ["banking.read"] });
const canWrite = authorize({ anyPermission: ["banking.write"] });

export function registerBankingRoutes(app: Express): void {
  const controller = new BankingController();

  app.get("/api/banking/totals", requireAuth, canRead, asyncHandler(controller.totals));
  app.get("/api/banking/accounts", requireAuth, canRead, asyncHandler(controller.listAccounts));
  app.get("/api/banking/accounts/:id", requireAuth, canRead, asyncHandler(controller.getAccount));
  app.post("/api/banking/accounts", requireAuth, canWrite, asyncHandler(controller.createAccount));
  app.patch(
    "/api/banking/accounts/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.updateAccount)
  );
  app.delete(
    "/api/banking/accounts/:id",
    requireAuth,
    canWrite,
    asyncHandler(controller.archiveAccount)
  );

  app.get(
    "/api/banking/transactions",
    requireAuth,
    canRead,
    asyncHandler(controller.listTransactions)
  );
  app.post(
    "/api/banking/transactions",
    requireAuth,
    canWrite,
    asyncHandler(controller.createTransaction)
  );
  app.post("/api/banking/transfer", requireAuth, canWrite, asyncHandler(controller.transfer));
  app.patch(
    "/api/banking/transactions/:id/reconcile",
    requireAuth,
    canWrite,
    asyncHandler(controller.setReconciled)
  );
}
