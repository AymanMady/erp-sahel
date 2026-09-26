/**
 * Application navigation.
 *
 * Each entry carries its **permission** and, when relevant, its **module** (POS,
 * purchasing, inventory…): the sidebar is filtered at render time, so a cashier does
 * not see accounting and a shop that only uses the POS and inventory gets a menu of
 * just a few lines.
 *
 * This filtering is **ergonomic**, not a security measure: the real authorization is
 * checked server-side on every endpoint.
 *
 * Labels are i18n keys of the `nav` namespace (`titleKey`/`labelKey`), translated at
 * render time so that switching the language updates the menu immediately.
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
  IconReceipt,
  IconRefresh,
  IconSettings,
  IconTool,
  IconTruckDelivery,
  type Icon,
} from "@tabler/icons-react";

import type { PermissionCode } from "@shared/rbac";
import type { ModuleCode } from "@shared/schema";

export interface NavChild {
  /** i18n key in the `nav` namespace. */
  titleKey: string;
  url: string;
  permission?: PermissionCode;
  module?: ModuleCode;
}

export interface NavItem {
  /** i18n key in the `nav` namespace. */
  titleKey: string;
  url?: string;
  icon?: Icon;
  badge?: string;
  permission?: PermissionCode;
  /** Entry shown only when this module is enabled. */
  module?: ModuleCode;
  items?: NavChild[];
}

export interface NavGroup {
  /** i18n key in the `nav` namespace. */
  labelKey: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    labelKey: "groups.home",
    items: [{ titleKey: "items.dashboard", url: "/", icon: IconLayoutDashboard }],
  },
  {
    labelKey: "groups.sell",
    items: [
      {
        titleKey: "items.pos",
        url: "/pos",
        icon: IconCashRegister,
        module: "pos",
        permission: "pos.use",
      },
      {
        titleKey: "items.salesDocuments",
        icon: IconClipboardList,
        module: "sales",
        permission: "sales.read",
        items: [
          { titleKey: "items.quotes", url: "/quotes" },
          { titleKey: "items.salesOrders", url: "/sales-orders" },
        ],
      },
      {
        titleKey: "items.invoices",
        icon: IconFileInvoice,
        module: "invoicing",
        permission: "invoicing.read",
        items: [
          { titleKey: "items.customerInvoices", url: "/invoices" },
          { titleKey: "items.creditNotes", url: "/credit-notes" },
        ],
      },
      {
        titleKey: "items.payments",
        url: "/payments",
        icon: IconReceipt,
        permission: "payments.read",
      },
    ],
  },
  {
    labelKey: "groups.buyAndStock",
    items: [
      {
        titleKey: "items.purchasing",
        icon: IconTruckDelivery,
        module: "purchasing",
        permission: "purchasing.read",
        items: [
          { titleKey: "items.purchaseOrders", url: "/purchase-orders" },
          { titleKey: "items.goodsReceipts", url: "/goods-receipts" },
          { titleKey: "items.supplierInvoices", url: "/supplier-invoices" },
        ],
      },
      {
        titleKey: "items.inventory",
        icon: IconPackages,
        module: "inventory",
        permission: "inventory.read",
        items: [
          { titleKey: "items.stockOnHand", url: "/inventory" },
          { titleKey: "items.stockMovements", url: "/inventory/movements" },
          { titleKey: "items.warehouses", url: "/warehouses" },
        ],
      },
    ],
  },
  {
    labelKey: "groups.productsAndCustomers",
    items: [
      {
        titleKey: "items.products",
        icon: IconBox,
        permission: "catalog.read",
        items: [
          { titleKey: "items.productList", url: "/products" },
          { titleKey: "items.categories", url: "/categories" },
        ],
      },
      {
        titleKey: "items.services",
        url: "/services",
        icon: IconTool,
        module: "services",
        permission: "services.read",
      },
      {
        titleKey: "items.parties",
        url: "/parties",
        icon: IconAddressBook,
        permission: "parties.read",
      },
    ],
  },
  {
    labelKey: "groups.money",
    items: [
      {
        titleKey: "items.banking",
        url: "/banking",
        icon: IconBuildingBank,
        module: "banking",
        permission: "banking.read",
      },
      {
        titleKey: "items.reports",
        icon: IconChartBar,
        module: "reports",
        permission: "reports.read",
        items: [
          { titleKey: "items.salesReport", url: "/reports/sales" },
          { titleKey: "items.stockReport", url: "/reports/stock" },
          { titleKey: "items.purchasesReport", url: "/reports/purchases" },
        ],
      },
      {
        titleKey: "items.accounting",
        icon: IconCalculator,
        module: "accounting",
        permission: "accounting.read",
        items: [
          { titleKey: "items.journal", url: "/accounting/entries" },
          { titleKey: "items.ledger", url: "/accounting/ledger" },
          { titleKey: "items.trialBalance", url: "/accounting/balance" },
          { titleKey: "items.chartOfAccounts", url: "/accounting/accounts" },
        ],
      },
    ],
  },
  {
    labelKey: "groups.settings",
    items: [
      {
        titleKey: "items.settings",
        icon: IconSettings,
        items: [
          { titleKey: "items.company", url: "/settings/company", permission: "settings.read" },
          { titleKey: "items.modules", url: "/settings/modules", permission: "settings.read" },
          { titleKey: "items.users", url: "/settings/users", permission: "users.read" },
          { titleKey: "items.roles", url: "/settings/roles", permission: "users.read" },
          { titleKey: "items.numbering", url: "/settings/numbering", permission: "settings.read" },
          {
            titleKey: "items.registers",
            url: "/settings/registers",
            module: "pos",
            permission: "settings.read",
          },
        ],
      },
      { titleKey: "items.sync", url: "/sync", icon: IconRefresh },
    ],
  },
];

/**
 * Module required by an application path, derived from the menu: a screen of a
 * disabled module shows an invitation to enable it rather than an error.
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

/**
 * Icon of the menu entry matching a path (longest prefix wins), shown in the page
 * title band. A sub-entry borrows its parent's icon.
 */
export function navIconForPath(pathname: string): Icon | undefined {
  let best: { icon: Icon; length: number } | undefined;
  const consider = (url: string | undefined, icon: Icon | undefined) => {
    if (!url || !icon) return;
    const matches =
      url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(`${url}/`);
    if (matches && (!best || url.length > best.length)) best = { icon, length: url.length };
  };
  for (const group of navGroups) {
    for (const item of group.items) {
      consider(item.url, item.icon);
      for (const child of item.items ?? []) consider(child.url, item.icon);
    }
  }
  return best?.icon;
}

/** Brand icon shown in the sidebar header. */
export const brandIcon = IconBuildingStore;

/**
 * Filters the navigation by permissions and enabled modules.
 * A group whose entries are all hidden disappears entirely, so that no orphan
 * section heading is left behind.
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
        )
        // A parent whose sub-entries are all hidden would open onto nothing.
        .filter((item) => !item.items || item.items.length > 0),
    }))
    .filter((group) => group.items.length > 0);
}

/** Translates a key of the `nav` namespace (pass `t` from `useTranslation("nav")`). */
export type NavTranslate = (key: string) => string;

/** Every "leaf" entry, translated, for the command palette (⌘K). */
export function flattenNav(
  groups: NavGroup[],
  t: NavTranslate
): { title: string; url: string; group: string }[] {
  const result: { title: string; url: string; group: string }[] = [];
  for (const group of groups) {
    const groupLabel = t(group.labelKey);
    for (const item of group.items) {
      const itemTitle = t(item.titleKey);
      if (item.url) result.push({ title: itemTitle, url: item.url, group: groupLabel });
      for (const child of item.items ?? []) {
        result.push({
          title: `${itemTitle} › ${t(child.titleKey)}`,
          url: child.url,
          group: groupLabel,
        });
      }
    }
  }
  return result;
}
