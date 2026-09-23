/**
 * Tableau de bord et rapports ([FR-RPT-1] à [FR-RPT-3]).
 *
 * Ce domaine ne possède aucune table : il **agrège** les vues des domaines
 * propriétaires via leurs applications respectives. C'est ce qui évite que les
 * rapports divergent de la donnée opérationnelle — ils lisent la même source.
 */

import { addDays, todayInput } from "@shared/format";
import { inventoryApplication } from "../inventory/application";
import { invoicingRepository } from "../invoicing/repository";
import { bankingApplication } from "../banking/application";
import { catalogApplication } from "../catalog/application";
import { partiesApplication } from "../parties/application";
import { paymentsApplication } from "../payments/application";
import { purchasingRepository } from "../purchasing/repository";
import { servicesRepository } from "../services/routes";

export interface PeriodInput {
  fromDate?: string | null;
  toDate?: string | null;
}

/** Période par défaut : les 30 derniers jours, bornes incluses. */
function resolvePeriod(input: PeriodInput): { fromDate: string; toDate: string } {
  const toDate = input.toDate ?? todayInput();
  const fromDate = input.fromDate ?? addDays(toDate, -29);
  return { fromDate, toDate };
}

class ReportsApplication {
  /** Synthèse du tableau de bord : indicateurs, série quotidienne, alertes. */
  async dashboard(companyId: string, input: PeriodInput = {}) {
    const { fromDate, toDate } = resolvePeriod(input);

    const [sales, daily, topProducts, purchases, treasury, stock, lowStock, parties, catalog] =
      await Promise.all([
        invoicingRepository.salesSummary(companyId, fromDate, toDate),
        invoicingRepository.dailyRevenue(companyId, fromDate, toDate),
        invoicingRepository.topProducts(companyId, fromDate, toDate, 5),
        purchasingRepository.purchaseSummary(companyId, fromDate, toDate),
        bankingApplication.treasuryTotals(companyId),
        inventoryApplication.valuation(companyId),
        inventoryApplication.lowStock(companyId, 10),
        partiesApplication.counts(companyId),
        catalogApplication.counts(companyId),
      ]);
    const serviceCount = await servicesRepository.count(companyId);

    return {
      period: { fromDate, toDate },
      sales,
      purchases,
      treasury,
      stock,
      counts: { ...parties, products: catalog.total, services: serviceCount },
      dailyRevenue: daily,
      topProducts,
      lowStock,
      /** Marge brute approchée : CA HT − achats HT sur la période. */
      grossMarginCents: sales.totalHtCents - purchases.totalHtCents,
    };
  }

  async salesReport(companyId: string, input: PeriodInput = {}) {
    const { fromDate, toDate } = resolvePeriod(input);
    const [summary, daily, topProducts, collections] = await Promise.all([
      invoicingRepository.salesSummary(companyId, fromDate, toDate),
      invoicingRepository.dailyRevenue(companyId, fromDate, toDate),
      invoicingRepository.topProducts(companyId, fromDate, toDate, 20),
      paymentsApplication.collectionsByMethod(companyId, fromDate, toDate),
    ]);
    return { period: { fromDate, toDate }, summary, daily, topProducts, collections };
  }

  async stockReport(companyId: string, warehouseId?: string | null) {
    const [valuation, lowStock] = await Promise.all([
      inventoryApplication.valuation(companyId, warehouseId ?? null),
      inventoryApplication.lowStock(companyId, 100),
    ]);
    return { valuation, lowStock };
  }

  async purchasesReport(companyId: string, input: PeriodInput = {}) {
    const { fromDate, toDate } = resolvePeriod(input);
    return {
      period: { fromDate, toDate },
      summary: await purchasingRepository.purchaseSummary(companyId, fromDate, toDate),
    };
  }
}

export const reportsApplication = new ReportsApplication();
