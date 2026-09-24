/**
 * Catalogue des modules — source unique serveur + client.
 *
 * L'ERP est générique : il sert n'importe quel commerce (pièces auto, vêtements,
 * alimentation, quincaillerie…). Chaque fonctionnalité (caisse, achats, stock…) est un
 * **module** activable par société. Un commerçant choisit un niveau (simple, avec
 * factures, complet) puis peut affiner module par module.
 */

import type { ModuleCode } from "./schema/plugins";

export interface FeatureModuleDefinition {
  code: ModuleCode;
  /** Libellé court, en mots simples. */
  name: string;
  /** Une phrase qui dit à quoi sert le module, sans jargon. */
  description: string;
  icon: string;
  dependencies: ModuleCode[];
  /** Routes API servies par ce module : refusées (403) quand il est désactivé. */
  apiPrefixes: string[];
  /**
   * Lectures restant ouvertes même module désactivé, car d'autres écrans s'en
   * servent (ex. liste des comptes bancaires dans le règlement d'une facture).
   */
  openReads?: string[];
}

export const FEATURE_MODULES: FeatureModuleDefinition[] = [
  {
    code: "pos",
    name: "Caisse",
    description: "Vendre au comptoir rapidement, encaisser et imprimer le ticket.",
    icon: "IconCashRegister",
    dependencies: [],
    apiPrefixes: ["/api/pos"],
  },
  {
    code: "invoicing",
    name: "Factures",
    description: "Faire des factures clients et des avoirs.",
    icon: "IconFileInvoice",
    dependencies: [],
    apiPrefixes: ["/api/invoices", "/api/credit-notes"],
  },
  {
    code: "sales",
    name: "Devis et commandes",
    description: "Préparer un devis, le transformer en commande puis en facture.",
    icon: "IconClipboardList",
    dependencies: ["invoicing"],
    apiPrefixes: ["/api/quotes", "/api/sales-orders"],
  },
  {
    code: "purchasing",
    name: "Achats",
    description: "Commander chez les fournisseurs et recevoir la marchandise.",
    icon: "IconTruckDelivery",
    dependencies: ["inventory"],
    apiPrefixes: ["/api/purchase-orders", "/api/goods-receipts", "/api/supplier-invoices"],
  },
  {
    code: "inventory",
    name: "Stock",
    description: "Voir ce qui reste en magasin, les entrées et les sorties.",
    icon: "IconPackages",
    dependencies: [],
    apiPrefixes: ["/api/inventory"],
  },
  {
    code: "services",
    name: "Prestations",
    description: "Vendre des services (pose, réparation, livraison…).",
    icon: "IconTool",
    dependencies: [],
    apiPrefixes: ["/api/services"],
    // Le choix d'une ligne de document liste les prestations existantes.
    openReads: ["/api/services"],
  },
  {
    code: "banking",
    name: "Caisse et banque",
    description: "Suivre l'argent en caisse, en banque et sur Bankily / Masrvi / Sedad.",
    icon: "IconBuildingBank",
    dependencies: [],
    apiPrefixes: ["/api/banking"],
    // Le règlement d'une facture et le paramétrage des caisses choisissent un compte.
    openReads: ["/api/banking/accounts"],
  },
  {
    code: "accounting",
    name: "Comptabilité",
    description: "Journal, grand livre et balance (pour le comptable).",
    icon: "IconCalculator",
    dependencies: [],
    apiPrefixes: ["/api/accounting"],
  },
  {
    code: "reports",
    name: "Rapports",
    description: "Chiffres des ventes, des achats et du stock.",
    icon: "IconChartBar",
    dependencies: [],
    apiPrefixes: ["/api/reports"],
  },
];

/** Niveau d'utilisation proposé : un préréglage de modules. */
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
    description: "Caisse, stock et achats. Idéal pour une boutique.",
    icon: "IconBuildingStore",
    modules: SIMPLE,
  },
  {
    code: "invoices",
    name: "Avec factures",
    description: "En plus : devis, factures, prestations et rapports.",
    icon: "IconFileInvoice",
    modules: WITH_INVOICES,
  },
  {
    code: "full",
    name: "Complet",
    description: "Tout, y compris la banque et la comptabilité.",
    icon: "IconApps",
    modules: [...WITH_INVOICES, "banking", "accounting"],
  },
];

export const MODULE_PRESET_CODES = MODULE_PRESETS.map((preset) => preset.code);

export function moduleName(code: string): string {
  return FEATURE_MODULES.find((feature) => feature.code === code)?.name ?? code;
}
