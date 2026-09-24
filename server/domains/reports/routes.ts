/** Report and dashboard routes. */

import type { Express } from "express";
import { z } from "zod";

import { asyncHandler } from "../../shared/http/handler";
import { authOf, authorize, requireAuth } from "../auth/guards";
import { reportsApplication } from "./application";

const periodQuerySchema = z.object({
  fromDate: z.string().date().nullish(),
  toDate: z.string().date().nullish(),
});

const canRead = authorize({ anyPermission: ["reports.read"] });

export function registerReportsRoutes(app: Express): void {
  app.get(
    "/api/dashboard",
    requireAuth,
    asyncHandler(async (req, res) => {
      // The dashboard is the first screen: it stays accessible to every authenticated
      // user, even if it only shows zeros.
      res.json(
        await reportsApplication.dashboard(
          authOf(req).companyId,
          periodQuerySchema.parse(req.query ?? {})
        )
      );
    })
  );

  app.get(
    "/api/reports/sales",
    requireAuth,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(
        await reportsApplication.salesReport(
          authOf(req).companyId,
          periodQuerySchema.parse(req.query ?? {})
        )
      );
    })
  );

  app.get(
    "/api/reports/stock",
    requireAuth,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(
        await reportsApplication.stockReport(
          authOf(req).companyId,
          typeof req.query.warehouseId === "string" ? req.query.warehouseId : null
        )
      );
    })
  );

  app.get(
    "/api/reports/purchases",
    requireAuth,
    canRead,
    asyncHandler(async (req, res) => {
      res.json(
        await reportsApplication.purchasesReport(
          authOf(req).companyId,
          periodQuerySchema.parse(req.query ?? {})
        )
      );
    })
  );
}
