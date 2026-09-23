/**
 * Navigation de l'application.
 *
 * Chaque entrée porte sa **permission** et, pour les modules métier, son **code de
 * module** : la barre latérale est filtrée à l'affichage, de sorte qu'un caissier ne
 * voie pas la comptabilité et qu'une société sans module Vêtements n'ait pas d'entrée
 * « Vêtements » ([FR-PLAT-3], [BR-12]).
 *
 * Ce filtrage est **ergonomique**, pas sécuritaire : l'autorisation réelle est
 * vérifiée côté serveur sur chaque endpoint.
 */

import {
  IconAddressBook,
  IconBox,
  IconBuildingBank,
  IconBuildingStore,
  IconCalculator,
  IconCar,
  IconCashRegister,
  IconChartBar,
  IconClipboardList,
  IconFileInvoice,
  IconHistory,
  IconLayoutDashboard,
  IconPackages,
  IconReceipt,
  IconRefresh,
  IconSettings,
  IconShirt,
  IconShoppingBag,
  IconShoppingCart,
  IconTool,
  IconTruckDelivery,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";

import type { PermissionCode } from "@shared/rbac";
import type { ModuleCode } from "@shared/schema";

export interface NavChild {
  title: string;
  url: string;
  permission?: PermissionCode;
}

export interface NavItem {
  title: string;
  url?: string;
  icon?: Icon;
  badge?: string;
  permission?: PermissionCode;
  /** Entrée conditionnée à l'activation d'un module métier. */
  module?: ModuleCode;
  items?: NavChild[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Pilotage",
    items: [
      { title: "Tableau de bord", url: "/", icon: IconLayoutDashboard },
      {
        title: "Rapports",
        icon: IconChartBar,
        permission: "reports.read",
        items: [
          { title: "Ventes", url: "/reports/sales" },
          { title: "Stock", url: "/reports/stock" },
          { title: "Achats", url: "/reports/purchases" },
        ],
      },
    ],
  },
  {
    label: "Vente",
    items: [
      { title: "Caisse (POS)", url: "/pos", icon: IconCashRegister, permission: "pos.use" },
      { title: "Devis", url: "/quotes", icon: IconClipboardList, permission: "sales.read" },
      {
        title: "Commandes",
        url: "/sales-orders",
        icon: IconShoppingCart,
        permission: "sales.read",
      },
      {
        title: "Factures",
        icon: IconFileInvoice,
        permission: "invoicing.read",
        items: [
          { title: "Factures clients", url: "/invoices" },
          { title: "Avoirs", url: "/credit-notes" },
        ],
      },
      { title: "Règlements", url: "/payments", icon: IconReceipt, permission: "payments.read" },
    ],
  },
  {
    label: "Achat & stock",
    items: [
      {
        title: "Achats",
        icon: IconTruckDelivery,
        permission: "purchasing.read",
        items: [
          { title: "Commandes fournisseurs", url: "/purchase-orders" },
          { title: "Réceptions", url: "/goods-receipts" },
          { title: "Factures fournisseurs", url: "/supplier-invoices" },
        ],
      },
      {
        title: "Stock",
        icon: IconPackages,
        permission: "inventory.read",
        items: [
          { title: "État du stock", url: "/inventory" },
          { title: "Mouvements", url: "/inventory/movements" },
          { title: "Magasins", url: "/warehouses" },
        ],
      },
    ],
  },
  {
    label: "Référentiels",
    items: [
      { title: "Tiers", url: "/parties", icon: IconAddressBook, permission: "parties.read" },
      {
        title: "Catalogue",
        icon: IconBox,
        permission: "catalog.read",
        items: [
          { title: "Produits", url: "/products" },
          { title: "Catégories", url: "/categories" },
        ],
      },
      { title: "Prestations", url: "/services", icon: IconTool, permission: "services.read" },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Trésorerie", url: "/banking", icon: IconBuildingBank, permission: "banking.read" },
      {
        title: "Comptabilité",
        icon: IconCalculator,
        permission: "accounting.read",
        items: [
          { title: "Journal", url: "/accounting/entries" },
          { title: "Grand livre", url: "/accounting/ledger" },
          { title: "Balance", url: "/accounting/balance" },
          { title: "Plan comptable", url: "/accounting/accounts" },
        ],
      },
    ],
  },
  {
    label: "Modules métier",
    items: [
      {
        title: "Pièces auto",
        icon: IconCar,
        module: "auto_parts",
        permission: "auto_parts.read",
        items: [
          { title: "Recherche OEM", url: "/modules/auto-parts/search" },
          { title: "Équivalences", url: "/modules/auto-parts/equivalences" },
          { title: "Fabricants", url: "/modules/auto-parts/manufacturers" },
          { title: "Véhicules", url: "/modules/auto-parts/vehicles" },
        ],
      },
      {
        title: "Vêtements",
        icon: IconShirt,
        module: "clothing",
        permission: "clothing.read",
        items: [{ title: "Grilles de tailles", url: "/modules/clothing/size-grids" }],
      },
      {
        title: "Marché",
        icon: IconShoppingBag,
        module: "market",
        permission: "market.read",
        items: [
          { title: "Lots & DLC", url: "/modules/market/lots" },
          { title: "Alertes péremption", url: "/modules/market/expiring" },
        ],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Synchronisation", url: "/sync", icon: IconRefresh },
      {
        title: "Paramètres",
        icon: IconSettings,
        permission: "settings.read",
        items: [
          { title: "Société", url: "/settings/company" },
          { title: "Modules", url: "/settings/modules" },
          { title: "Numérotation", url: "/settings/numbering" },
          { title: "Caisses", url: "/settings/registers" },
        ],
      },
      {
        title: "Utilisateurs",
        icon: IconUsers,
        permission: "users.read",
        items: [
          { title: "Comptes", url: "/settings/users" },
          { title: "Rôles & permissions", url: "/settings/roles" },
        ],
      },
      {
        title: "Journal d'audit",
        url: "/settings/audit",
        icon: IconHistory,
        permission: "audit.read",
      },
    ],
  },
];

/** Icône de l'enseigne affichée dans l'en-tête de la barre latérale. */
export const brandIcon = IconBuildingStore;

/**
 * Filtre la navigation selon les permissions et les modules activés.
 * Un groupe dont toutes les entrées sont masquées disparaît entièrement, pour ne
 * pas laisser d'intitulé de section orphelin.
 */
export function visibleNavGroups(
  can: (permission: PermissionCode) => boolean,
  hasModule: (code: string) => boolean
): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.module && !hasModule(item.module)) return false;
        if (item.permission && !can(item.permission)) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/** Toutes les entrées « feuille », pour la palette de commandes (⌘K). */
export function flattenNav(groups: NavGroup[]): { title: string; url: string; group: string }[] {
  const result: { title: string; url: string; group: string }[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (item.url) result.push({ title: item.title, url: item.url, group: group.label });
      for (const child of item.items ?? []) {
        result.push({
          title: `${item.title} › ${child.title}`,
          url: child.url,
          group: group.label,
        });
      }
    }
  }
  return result;
}
