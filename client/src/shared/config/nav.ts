/**
 * Navigation de l'application.
 *
 * Chaque entrée porte sa **permission** et, le cas échéant, son **module** (caisse,
 * achats, stock…) : la barre latérale est filtrée à l'affichage, de sorte qu'un
 * caissier ne voie pas la comptabilité et qu'une boutique qui n'utilise que la caisse
 * et le stock n'ait qu'un menu de quelques lignes.
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
  IconCashRegister,
  IconChartBar,
  IconClipboardList,
  IconFileInvoice,
  IconLayoutDashboard,
  IconPackages,
  IconPuzzle,
  IconReceipt,
  IconRefresh,
  IconSettings,
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
  module?: ModuleCode;
}

export interface NavItem {
  title: string;
  url?: string;
  icon?: Icon;
  badge?: string;
  permission?: PermissionCode;
  /** Entrée conditionnée à l'activation d'un module. */
  module?: ModuleCode;
  items?: NavChild[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Accueil",
    items: [{ title: "Tableau de bord", url: "/", icon: IconLayoutDashboard }],
  },
  {
    label: "Vendre",
    items: [
      {
        title: "Caisse",
        url: "/pos",
        icon: IconCashRegister,
        module: "pos",
        permission: "pos.use",
      },
      {
        title: "Devis",
        url: "/quotes",
        icon: IconClipboardList,
        module: "sales",
        permission: "sales.read",
      },
      {
        title: "Commandes clients",
        url: "/sales-orders",
        icon: IconShoppingCart,
        module: "sales",
        permission: "sales.read",
      },
      {
        title: "Factures",
        icon: IconFileInvoice,
        module: "invoicing",
        permission: "invoicing.read",
        items: [
          { title: "Factures clients", url: "/invoices" },
          { title: "Avoirs (retours)", url: "/credit-notes" },
        ],
      },
      { title: "Paiements", url: "/payments", icon: IconReceipt, permission: "payments.read" },
    ],
  },
  {
    label: "Acheter et stocker",
    items: [
      {
        title: "Achats",
        icon: IconTruckDelivery,
        module: "purchasing",
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
        module: "inventory",
        permission: "inventory.read",
        items: [
          { title: "Ce qui reste", url: "/inventory" },
          { title: "Entrées et sorties", url: "/inventory/movements" },
          { title: "Magasins", url: "/warehouses" },
        ],
      },
    ],
  },
  {
    label: "Produits et clients",
    items: [
      {
        title: "Produits",
        icon: IconBox,
        permission: "catalog.read",
        items: [
          { title: "Liste des produits", url: "/products" },
          { title: "Catégories", url: "/categories" },
        ],
      },
      {
        title: "Prestations",
        url: "/services",
        icon: IconTool,
        module: "services",
        permission: "services.read",
      },
      {
        title: "Clients et fournisseurs",
        url: "/parties",
        icon: IconAddressBook,
        permission: "parties.read",
      },
    ],
  },
  {
    label: "Argent",
    items: [
      {
        title: "Caisse et banque",
        url: "/banking",
        icon: IconBuildingBank,
        module: "banking",
        permission: "banking.read",
      },
      {
        title: "Rapports",
        icon: IconChartBar,
        module: "reports",
        permission: "reports.read",
        items: [
          { title: "Ventes", url: "/reports/sales" },
          { title: "Stock", url: "/reports/stock" },
          { title: "Achats", url: "/reports/purchases" },
        ],
      },
      {
        title: "Comptabilité",
        icon: IconCalculator,
        module: "accounting",
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
    label: "Réglages",
    items: [
      {
        title: "Modules",
        url: "/settings/modules",
        icon: IconPuzzle,
        permission: "settings.read",
      },
      {
        title: "Paramètres",
        icon: IconSettings,
        permission: "settings.read",
        items: [
          { title: "Ma société", url: "/settings/company" },
          { title: "Numérotation", url: "/settings/numbering" },
          { title: "Caisses", url: "/settings/registers", module: "pos" },
        ],
      },
      {
        title: "Utilisateurs",
        icon: IconUsers,
        permission: "users.read",
        items: [
          { title: "Comptes", url: "/settings/users" },
          { title: "Rôles et droits", url: "/settings/roles" },
        ],
      },
      { title: "Synchronisation", url: "/sync", icon: IconRefresh },
    ],
  },
];

/**
 * Module requis par une adresse de l'application, déduit du menu : un écran d'un
 * module désactivé affiche une invitation à l'activer plutôt qu'une erreur.
 */
export function moduleForPath(pathname: string): ModuleCode | undefined {
  let best: { module: ModuleCode; length: number } | undefined;
  const consider = (url: string | undefined, module: ModuleCode | undefined) => {
    if (!url || !module || url === "/") return;
    if (pathname !== url && !pathname.startsWith(`${url}/`)) return;
    if (!best || url.length > best.length) best = { module, length: url.length };
  };
  for (const group of navGroups) {
    for (const item of group.items) {
      consider(item.url, item.module);
      for (const child of item.items ?? []) consider(child.url, child.module ?? item.module);
    }
  }
  return best?.module;
}

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
      items: group.items
        .filter((item) => {
          if (item.module && !hasModule(item.module)) return false;
          if (item.permission && !can(item.permission)) return false;
          return true;
        })
        .map((item) =>
          item.items
            ? {
                ...item,
                items: item.items.filter(
                  (child) =>
                    (!child.module || hasModule(child.module)) &&
                    (!child.permission || can(child.permission))
                ),
              }
            : item
        ),
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
