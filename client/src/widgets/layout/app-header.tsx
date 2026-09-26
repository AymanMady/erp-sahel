/**
 * Application header (ArchitectUI `.app-header`): breadcrumb, screen search
 * (Ctrl+K), point-of-sale shortcut, sync status, language and light/dark theme.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCashRegister, IconSearch } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";

import { useSession } from "@/shared/auth/session";
import { flattenNav, visibleNavGroups } from "@/shared/config/nav";
import { LanguageSwitcher } from "@/shared/components/language-switcher";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { Button } from "@/shared/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import { Separator } from "@/shared/ui/separator";
import { SidebarTrigger } from "@/shared/ui/sidebar";
import type { SyncStatus } from "@/shared/offline/sync-engine";
import { SyncIndicator } from "./sync-indicator";

/** URL segments whose human label cannot be derived from the text (keys of `nav:crumbs`). */
const CRUMB_KEYS: Record<string, string> = {
  pos: "pos",
  quotes: "quotes",
  "sales-orders": "salesOrders",
  invoices: "invoices",
  "credit-notes": "creditNotes",
  payments: "payments",
  "purchase-orders": "purchaseOrders",
  "goods-receipts": "goodsReceipts",
  "supplier-invoices": "supplierInvoices",
  inventory: "inventory",
  movements: "movements",
  warehouses: "warehouses",
  parties: "parties",
  products: "products",
  categories: "categories",
  services: "services",
  banking: "banking",
  accounting: "accounting",
  entries: "entries",
  ledger: "ledger",
  balance: "balance",
  accounts: "accounts",
  settings: "settings",
  company: "company",
  users: "users",
  roles: "roles",
  modules: "modules",
  numbering: "numbering",
  registers: "registers",
  audit: "audit",
  reports: "reports",
  sales: "sales",
  stock: "stock",
  purchases: "purchases",
  sync: "sync",
  search: "search",
  equivalences: "equivalences",
  manufacturers: "manufacturers",
  vehicles: "vehicles",
  "size-grids": "sizeGrids",
  lots: "lots",
  expiring: "expiring",
  new: "new",
  edit: "edit",
  profile: "profile",
};

function useBreadcrumb(pathname: string): string[] {
  const { t } = useTranslation("nav");
  return useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return [t("crumbs.dashboard")];
    return segments.map((segment) => {
      const key = CRUMB_KEYS[segment];
      if (key) return t(`crumbs.${key}`);
      // Identifiers (UUIDs) have no readable label: shorten them.
      if (/^[0-9a-f]{8}-/i.test(segment)) return `#${segment.slice(0, 8)}`;
      return segment.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    });
  }, [pathname, t]);
}

export function AppHeader({ syncStatus }: { syncStatus: SyncStatus }) {
  const [pathname, navigate] = useLocation();
  const crumbs = useBreadcrumb(pathname);
  const [open, setOpen] = useState(false);
  const { can, hasModule } = useSession();
  const { t } = useTranslation("nav");

  const entries = useMemo(
    () => flattenNav(visibleNavGroups(can, hasModule), t),
    [can, hasModule, t]
  );

  const go = useCallback(
    (url: string) => {
      setOpen(false);
      navigate(url);
    },
    [navigate]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const grouped = useMemo(() => {
    const byGroup = new Map<string, { title: string; url: string }[]>();
    for (const entry of entries) {
      const bucket = byGroup.get(entry.group) ?? [];
      bucket.push({ title: entry.title, url: entry.url });
      byGroup.set(entry.group, bucket);
    }
    return [...byGroup.entries()];
  }, [entries]);

  return (
    <header
      data-app-header
      className="sticky top-0 z-30 flex h-15 shrink-0 items-center gap-2 border-b bg-card px-4"
    >
      <SidebarTrigger className="-ms-1" />
      <Separator orientation="vertical" className="me-1 h-4" />

      <Breadcrumb className="min-w-0">
        <BreadcrumbList>
          {crumbs.map((crumb, index) => (
            <BreadcrumbItem key={`${crumb}-${index}`} className="min-w-0">
              {index > 0 ? <BreadcrumbSeparator className="me-1.5" /> : null}
              <BreadcrumbPage className="truncate">{crumb}</BreadcrumbPage>
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ms-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="hidden gap-2 text-muted-foreground md:flex"
          onClick={() => setOpen(true)}
        >
          <IconSearch className="size-4" />
          <span>{t("common:actions.searchEllipsis")}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t("common:actions.search")}
          onClick={() => setOpen(true)}
        >
          <IconSearch className="size-4" />
        </Button>

        {can("pos.use") && hasModule("pos") ? (
          <Button size="sm" asChild className="gap-2">
            <Link href="/pos">
              <IconCashRegister className="size-4" />
              <span className="hidden lg:inline">{t("items.pos")}</span>
            </Link>
          </Button>
        ) : null}

        <SyncIndicator status={syncStatus} />
        <LanguageSwitcher />
        <ThemeToggle />
      </div>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("palette.title")}
        description={t("palette.description")}
      >
        <CommandInput placeholder={t("palette.placeholder")} />
        <CommandList>
          <CommandEmpty>{t("common:states.noResults")}</CommandEmpty>
          {grouped.map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((item) => (
                <CommandItem
                  key={item.url}
                  value={`${group} ${item.title}`}
                  onSelect={() => go(item.url)}
                >
                  {item.title}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </header>
  );
}
