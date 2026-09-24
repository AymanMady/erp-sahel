/** Settings of the current company. */

import type { Express } from "express";
import { z } from "zod";

import { ACCOUNTING_STANDARDS } from "@shared/schema";
import { asyncHandler } from "../../shared/http/handler";
import { authOf, authorize, requireAuth } from "../auth/guards";
import { numberingApplication } from "../numbering/application";
import { tenancyApplication } from "./application";
import { companiesRepository } from "./repository";

const updateCompanySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  legalName: z.string().max(255).optional(),
  taxId: z.string().max(64).optional(),
  email: z.string().email().or(z.literal("")).optional(),
  phone: z.string().max(64).optional(),
  website: z.string().max(255).optional(),
  address: z.string().max(2000).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  /** Data URI or URL: used as the brand sign, PWA icon and favicon. */
  logo: z.string().max(2_000_000).nullish(),
  language: z.string().max(8).optional(),
  currency: z.string().length(3).optional(),
  accountingStandard: z.enum(ACCOUNTING_STANDARDS).optional(),
  vatEnabled: z.boolean().optional(),
  defaultVatRateBp: z.number().int().min(0).max(10_000).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  primaryModule: z.string().max(64).optional(),
});

const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(10_000),
});

export function registerTenancyRoutes(app: Express): void {
  app.get(
    "/api/company",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await tenancyApplication.requireCompany(authOf(req).companyId));
    })
  );

  app.patch(
    "/api/company",
    requireAuth,
    authorize({ anyPermission: ["settings.write"] }),
    asyncHandler(async (req, res) => {
      const data = updateCompanySchema.parse(req.body);
      res.json(await tenancyApplication.update(authOf(req).companyId, data));
    })
  );

  app.get(
    "/api/company/settings",
    requireAuth,
    authorize({ anyPermission: ["settings.read"] }),
    asyncHandler(async (req, res) => {
      res.json(await companiesRepository.listSettings(authOf(req).companyId));
    })
  );

  app.put(
    "/api/company/settings",
    requireAuth,
    authorize({ anyPermission: ["settings.write"] }),
    asyncHandler(async (req, res) => {
      const { key, value } = settingSchema.parse(req.body);
      await companiesRepository.upsertSetting(authOf(req).companyId, key, value);
      res.json({ success: true });
    })
  );

  app.get(
    "/api/company/sequences",
    requireAuth,
    authorize({ anyPermission: ["settings.read"] }),
    asyncHandler(async (req, res) => {
      res.json(await numberingApplication.listSequences(authOf(req).companyId));
    })
  );
}
