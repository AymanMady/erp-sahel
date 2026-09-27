/**
 * Dashboard and reports ([FR-RPT-1] to [FR-RPT-3]).
 *
 * This domain owns no table: it **aggregates** the views of the owning domains through
 * their respective applications. That is what keeps reports from diverging from the
 * operational data — they read the same source.
 */

import { addDays, todayInput } from "@shared/format";
import { inventoryApplication } from "../inventory/application";
import { invoicingRepository } from "../invoicing/repository";
import { bankingApplication } from "../banking/application";
import { catalogApplication } from "../catalog/application";
import { partiesApplication } from "../parties/application";
import { paymentsApplication } from "../payments/application";
import { servicesRepository } from "../services/routes";
import { reportsRepository } from "./repository";

export interface PeriodInput {
  fromDate?: string | null;
  toDate?: string | null;
}

/** Default period: the last 30 days, bounds included. */
function resolvePeriod(input: PeriodInput): { fromDate: string; toDate: string } {
  const toDate = input.toDate ?? todayInput();
  const fromDate = input.fromDate ?? addDays(toDate, -29);
  return { fromDate, toDate };
}

class ReportsApplication {
  /** Dashboard summary: indicators, daily series, alerts. */
  async dashboard(companyId: string, input: PeriodInput = {}) {
    const { fromDate, toDate } = resolvePeriod(input);

    const [
      sales,
      daily,
      topProducts,
      purchases,
      costOfGoodsSoldCents,
      treasury,
      stock,
      lowStock,
      parties,
      catalog,
    ] = await Promise.all([
      invoicingRepository.salesSummary(companyId, fromDate, toDate),
      reportsRepository.dailyNetSales(companyId, fromDate, toDate),
      reportsRepository.topProducts(companyId, fromDate, toDate, 5),
      reportsRepository.purchaseSummary(companyId, fromDate, toDate),
      reportsRepository.costOfGoodsSold(companyId, fromDate, toDate),
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
      /** What the goods sold over the period cost the shop (unit cost at stock exit). */
      costOfGoodsSoldCents,
      /**
       * Profit on sales ("gain sur les ventes"): net sales (after returns) minus what the
       * goods sold cost. Services have no stock cost, so they count in full.
       */
      grossMarginCents: sales.totalCents - costOfGoodsSoldCents,
    };
  }

  async salesReport(companyId: string, input: PeriodInput = {}) {
    const { fromDate, toDate } = resolvePeriod(input);
    const [summary, daily, topProducts, collections, costOfGoodsSoldCents] = await Promise.all([
      invoicingRepository.salesSummary(companyId, fromDate, toDate),
      reportsRepository.dailyNetSales(companyId, fromDate, toDate),
      reportsRepository.topProducts(companyId, fromDate, toDate, 20),
      paymentsApplication.collectionsByMethod(companyId, fromDate, toDate),
      reportsRepository.costOfGoodsSold(companyId, fromDate, toDate),
    ]);
    return {
      period: { fromDate, toDate },
      summary,
      daily,
      topProducts,
      collections,
      costOfGoodsSoldCents,
      grossMarginCents: summary.totalCents - costOfGoodsSoldCents,
    };
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
      summary: await reportsRepository.purchaseSummary(companyId, fromDate, toDate),
    };
  }
}

export const reportsApplication = new ReportsApplication();
