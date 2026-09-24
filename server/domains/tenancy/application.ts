/**
 * Company use cases: creating a complete tenant and accessing its configuration.
 *
 * Creating a company is not a plain `INSERT`: without a chart of accounts, a warehouse
 * and journals, no invoice can be validated. Bootstrapping is therefore part of the use
 * case, in the same transaction. Default names (warehouse, cash account, register,
 * accounts, journals) are written in the company's language, or the creator's.
 */

import {
  bankAccounts,
  posRegisters,
  warehouses,
  type Company,
  type InsertCompany,
} from "@shared/schema";
import { MODULE_PRESETS } from "@shared/modules-catalog";
import { runInTransaction, type Database } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { currentLocale, SUPPORTED_LOCALES, tr, type Locale } from "../../shared/i18n";
import { accountingApplication } from "../accounting/application";
import { moduleRegistry } from "../plugins/registry";
import { companiesRepository } from "./repository";

const SIMPLE_PRESET = MODULE_PRESETS.find((preset) => preset.code === "simple")!;

/** `language` as a supported locale, or `null` when it is missing or unsupported. */
function asLocale(language: string | null | undefined): Locale | null {
  const base = language?.toLowerCase().split("-")[0];
  return SUPPORTED_LOCALES.find((locale) => locale === base) ?? null;
}

class TenancyApplication {
  async requireCompany(companyId: string): Promise<Company> {
    const company = await companiesRepository.findById(companyId);
    if (!company) throw new NotFoundError("Company not found.");
    return company;
  }

  async findBySubdomain(subdomain: string): Promise<Company | null> {
    return companiesRepository.findBySubdomain(subdomain);
  }

  /** Creates the company and its minimal foundation: chart of accounts, journals, warehouse, register. */
  async create(input: InsertCompany): Promise<Company> {
    return runInTransaction(async (tx) => {
      const company = await companiesRepository.create(input, tx);
      // Default names follow the language chosen for the company, or the creator's
      // language when none was given (the column has a database default).
      await this.bootstrap(tx, company, asLocale(input.language) ?? currentLocale());
      // A new company starts at the "Simple" level (POS, stock, purchasing): a short
      // menu from day one. It enables the rest when it needs it.
      await moduleRegistry.applySelection(company.id, SIMPLE_PRESET.modules, tx);
      return company;
    });
  }

  /**
   * Idempotent bootstrap of an existing company — can be replayed after an update
   * that introduces new accounts or journals. Default names are written in `locale`
   * (the company's language by default).
   */
  async bootstrap(
    tx: Database,
    company: Company,
    locale: Locale = asLocale(company.language) ?? currentLocale()
  ): Promise<void> {
    await accountingApplication.installChartOfAccounts(tx, company, locale);

    const [warehouse] = await tx
      .insert(warehouses)
      .values({
        companyId: company.id,
        code: "PRINCIPAL",
        name: tr("Main warehouse", undefined, locale),
        isDefault: true,
      })
      .onConflictDoNothing()
      .returning();

    const [cashAccount] = await tx
      .insert(bankAccounts)
      .values({
        companyId: company.id,
        code: "CAISSE",
        name: tr("Main cash account", undefined, locale),
        accountType: "CASH",
        currency: company.currency,
        isDefault: true,
      })
      .onConflictDoNothing()
      .returning();

    if (warehouse) {
      await tx
        .insert(posRegisters)
        .values({
          companyId: company.id,
          code: "CAISSE-1",
          name: tr("Register {number}", { number: 1 }, locale),
          warehouseId: warehouse.id,
          cashAccountId: cashAccount?.id ?? null,
        })
        .onConflictDoNothing();
    }
  }

  async update(companyId: string, patch: Partial<InsertCompany>): Promise<Company> {
    const company = await companiesRepository.update(companyId, patch);
    if (!company) throw new NotFoundError("Company not found.");
    return company;
  }
}

export const tenancyApplication = new TenancyApplication();
