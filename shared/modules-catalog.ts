/**
 * Module catalog — single source for server and client.
 *
 * The ERP is generic: it serves any kind of shop (auto parts, clothing, groceries,
 * hardware…). Each feature (POS, purchasing, stock…) is a **module** that can be
 * enabled per company. A merchant picks a level (simple, with invoices, full) and can
 * then fine-tune module by module.
 *
 * Names and descriptions are the English source text: the client translates them by
 * `code`, and the server translates module names through its `plugins` catalog.
 */

import type { ModuleCode } from "./schema/plugins";

export interface FeatureModuleDefinition {
  code: ModuleCode;
  /** Short label, in plain words. */
  name: string;
  /** One sentence saying what the module is for, without jargon. */
  description: string;
  icon: string;
  dependencies: ModuleCode[];
  /** API routes served by this module: rejected (403) when it is disabled. */
  apiPrefixes: string[];
  /**
   * Reads that stay open even when the module is disabled, because other screens use
   * them (e.g. the bank account list when paying an invoice).
   */
  openReads?: string[];
}

export const FEATURE_MODULES: FeatureModuleDefinition[] = [
  {
    code: "pos",
    name: "Point of sale",
    description: "Sell quickly at the counter, take payment and print the receipt.",
    icon: "IconCashRegister",
    dependencies: [],
    apiPrefixes: ["/api/pos"],
  },
  {
    code: "invoicing",
    name: "Invoices",
    description: "Issue customer invoices and credit notes.",
    icon: "IconFileInvoice",
    dependencies: [],
    apiPrefixes: ["/api/invoices", "/api/credit-notes"],
  },
  {
    code: "sales",
    name: "Quotes and orders",
    description: "Prepare a quote, turn it into an order and then an invoice.",
    icon: "IconClipboardList",
    dependencies: ["invoicing"],
    apiPrefixes: ["/api/quotes", "/api/sales-orders"],
  },
  {
    code: "purchasing",
    name: "Purchasing",
    description: "Order from suppliers and receive the goods.",
    icon: "IconTruckDelivery",
    dependencies: ["inventory"],
    apiPrefixes: ["/api/purchase-orders", "/api/goods-receipts", "/api/supplier-invoices"],
  },
  {
    code: "inventory",
    name: "Stock",
    description: "See what is left in the warehouse, goods in and goods out.",
    icon: "IconPackages",
    dependencies: [],
    apiPrefixes: ["/api/inventory"],
  },
  {
    code: "services",
    name: "Services",
    description: "Sell services (installation, repair, delivery…).",
    icon: "IconTool",
    dependencies: [],
    apiPrefixes: ["/api/services"],
    // Picking a document line lists the existing services.
    openReads: ["/api/services"],
  },
  {
    code: "banking",
    name: "Cash and bank",
    description: "Track money in the till, in the bank and on Bankily / Masrvi / Sedad.",
    icon: "IconBuildingBank",
    dependencies: [],
    apiPrefixes: ["/api/banking"],
    // Paying an invoice and setting up registers both pick an account.
    openReads: ["/api/banking/accounts"],
  },
  {
    code: "accounting",
    name: "Accounting",
    description: "Journal, general ledger and trial balance (for the accountant).",
    icon: "IconCalculator",
    dependencies: [],
    apiPrefixes: ["/api/accounting"],
  },
  {
    code: "reports",
    name: "Reports",
    description: "Sales, purchasing and stock figures.",
    icon: "IconChartBar",
    dependencies: [],
    apiPrefixes: ["/api/reports"],
  },
];

/** Suggested usage level: a preset of modules. */
export interface ModulePreset {
  code: string;
  name: string;
  description: string;
  icon: string;
  modules: ModuleCode[];
}

const SIMPLE: ModuleCode[] = ["pos", "inventory", "purchasing"];
const WITH_INVOICES: ModuleCode[] = [...SIMPLE, "invoicing", "sales", "services", "reports"];

export const MODULE_PRESETS: ModulePreset[] = [
  {
    code: "simple",
    name: "Simple",
    description: "POS, stock and purchasing. Ideal for a shop.",
    icon: "IconBuildingStore",
    modules: SIMPLE,
  },
  {
    code: "invoices",
    name: "With invoices",
    description: "Plus: quotes, invoices, services and reports.",
    icon: "IconFileInvoice",
    modules: WITH_INVOICES,
  },
  {
    code: "full",
    name: "Full",
    description: "Everything, including banking and accounting.",
    icon: "IconApps",
    modules: [...WITH_INVOICES, "banking", "accounting"],
  },
];

export const MODULE_PRESET_CODES = MODULE_PRESETS.map((preset) => preset.code);

export function moduleName(code: string): string {
  return FEATURE_MODULES.find((feature) => feature.code === code)?.name ?? code;
}
