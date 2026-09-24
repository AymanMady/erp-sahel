/**
 * Catalogue des modules et des types d'activité — source unique serveur + client.
 *
 * Chaque fonctionnalité (caisse, achats, stock…) est un **module** activable par
 * société, au même titre que les modules métier. Un commerçant choisit son type
 * d'activité : le préréglage active uniquement ce dont il a besoin, et le menu reste
 * court. Il peut ensuite affiner module par module.
 */

import type { BusinessModuleCode, FeatureModuleCode, ModuleCode } from "./schema/plugins";

export interface FeatureModuleDefinition {
  code: FeatureModuleCode;
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

/** Type d'activité proposé au démarrage : un préréglage de modules. */
export interface BusinessPreset {
  code: string;
  name: string;
  description: string;
  icon: string;
  modules: ModuleCode[];
}

const SHOP_BASE: ModuleCode[] = ["pos", "inventory", "purchasing", "reports"];

export const BUSINESS_PRESETS: BusinessPreset[] = [
  {
    code: "shop",
    name: "Boutique",
    description: "Petit commerce : caisse, stock et achats. Le plus simple.",
    icon: "IconBuildingStore",
    modules: [...SHOP_BASE, "market"],
  },
  {
    code: "auto_parts",
    name: "Pièces auto",
    description: "Recherche par référence OEM, équivalences, véhicules, devis et factures.",
    icon: "IconCar",
    modules: [...SHOP_BASE, "invoicing", "sales", "services", "auto_parts"],
  },
  {
    code: "clothing",
    name: "Vêtements",
    description: "Tailles et couleurs, caisse et stock par article.",
    icon: "IconShirt",
    modules: [...SHOP_BASE, "clothing"],
  },
  {
    code: "wholesale",
    name: "Grossiste",
    description: "Ventes aux professionnels : devis, commandes, factures et règlements.",
    icon: "IconTruck",
    modules: [...SHOP_BASE, "invoicing", "sales", "banking", "market"],
  },
  {
    code: "full",
    name: "Tout activer",
    description: "Toutes les fonctionnalités, y compris la comptabilité.",
    icon: "IconApps",
    modules: [
      "pos",
      "sales",
      "invoicing",
      "purchasing",
      "inventory",
      "services",
      "banking",
      "accounting",
      "reports",
      "auto_parts",
      "clothing",
      "market",
    ],
  },
];

export const BUSINESS_PRESET_CODES = BUSINESS_PRESETS.map((preset) => preset.code);

export function isFeatureModule(code: string): code is FeatureModuleCode {
  return FEATURE_MODULES.some((feature) => feature.code === code);
}

export type { BusinessModuleCode, FeatureModuleCode };
