/**
 * Cas d'usage société : création d'un tenant complet et accès à sa configuration.
 *
 * Créer une société n'est pas un simple `INSERT` : sans plan comptable ni magasin ni
 * journaux, aucune facture ne peut être validée. L'amorçage fait donc partie du cas
 * d'usage, dans la même transaction.
 */

import {
  bankAccounts,
  posRegisters,
  warehouses,
  type Company,
  type InsertCompany,
} from "@shared/schema";
import { runInTransaction, type Database } from "../../db";
import { NotFoundError } from "../../shared/errors/app-error";
import { accountingApplication } from "../accounting/application";
import { companiesRepository } from "./repository";

class TenancyApplication {
  async requireCompany(companyId: string): Promise<Company> {
    const company = await companiesRepository.findById(companyId);
    if (!company) throw new NotFoundError("Société introuvable.");
    return company;
  }

  async findBySubdomain(subdomain: string): Promise<Company | null> {
    return companiesRepository.findBySubdomain(subdomain);
  }

  /** Crée la société et son socle minimal : plan comptable, journaux, magasin, caisse. */
  async create(input: InsertCompany): Promise<Company> {
    return runInTransaction(async (tx) => {
      const company = await companiesRepository.create(input, tx);
      await this.bootstrap(tx, company);
      return company;
    });
  }

  /**
   * Amorçage idempotent d'une société existante — rejouable après une mise à jour
   * qui introduirait de nouveaux comptes ou journaux.
   */
  async bootstrap(tx: Database, company: Company): Promise<void> {
    await accountingApplication.installChartOfAccounts(tx, company);

    const [warehouse] = await tx
      .insert(warehouses)
      .values({
        companyId: company.id,
        code: "PRINCIPAL",
        name: "Magasin principal",
        isDefault: true,
      })
      .onConflictDoNothing()
      .returning();

    const [cashAccount] = await tx
      .insert(bankAccounts)
      .values({
        companyId: company.id,
        code: "CAISSE",
        name: "Caisse principale",
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
          name: "Caisse 1",
          warehouseId: warehouse.id,
          cashAccountId: cashAccount?.id ?? null,
        })
        .onConflictDoNothing();
    }
  }

  async update(companyId: string, patch: Partial<InsertCompany>): Promise<Company> {
    const company = await companiesRepository.update(companyId, patch);
    if (!company) throw new NotFoundError("Société introuvable.");
    return company;
  }
}

export const tenancyApplication = new TenancyApplication();
