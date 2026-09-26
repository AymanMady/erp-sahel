/**
 * Application header, with the ArchitectUI template markup (`AppHeader/header.hbs`):
 * logo and sidebar toggle, screen search (Ctrl+K), everyday shortcuts, sync status,
 * language and user widget.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconCashRegister,
  IconDotsVertical,
  IconFileInvoice,
  IconPackages,
  type Icon,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";

import type { PermissionCode } from "@shared/rbac";
import type { ModuleCode } from "@shared/schema";
import { useSession } from "@/shared/auth/session";
import { flattenNav, visibleNavGroups } from "@/shared/config/nav";
import { LanguageSwitcher } from "@/shared/components/language-switcher";
import { cn } from "@/shared/lib/utils";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import type { SyncStatus } from "@/shared/offline/sync-engine";
import { CompanyBrand } from "./company-brand";
import { useLayoutState } from "./layout-state";
import { HeaderUser } from "./nav-user";
import { SyncIndicator } from "./sync-indicator";

/** Everyday screens, one click away in the header (`.header-menu`). */
const SHORTCUTS: {
  labelKey: string;
  href: string;
  icon: Icon;
  module?: ModuleCode;
  permission: PermissionCode;
}[] = [
  {
    labelKey: "items.pos",
    href: "/pos",
    icon: IconCashRegister,
    module: "pos",
    permission: "pos.use",
  },
  {
    labelKey: "items.invoices",
    href: "/invoices",
    icon: IconFileInvoice,
    module: "invoicing",
    permission: "invoicing.read",
  },
  {
    labelKey: "items.inventory",
    href: "/inventory",
    icon: IconPackages,
    module: "inventory",
    permission: "inventory.read",
  },
];

function Hamburger({
  active,
  onClick,
  label,
  className,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn("hamburger hamburger--elastic", active && "is-active", className)}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
    >
      <span className="hamburger-box">
        <span className="hamburger-inner" />
      </span>
    </button>
  );
}

export function AppHeader({ syncStatus }: { syncStatus: SyncStatus }) {
  const [, navigate] = useLocation();
  const {
    closedSidebar,
    toggleSidebar,
    mobileSidebarOpen,
    toggleMobileSidebar,
    mobileHeaderOpen,
    toggleMobileHeader,
  } = useLayoutState();
  const [open, setOpen] = useState(false);
  const { can, hasModule } = useSession();
  const { t } = useTranslation("nav");

  const shortcuts = SHORTCUTS.filter(
    (shortcut) => (!shortcut.module || hasModule(shortcut.module)) && can(shortcut.permission)
  );

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
    <div data-app-header className="app-header header-shadow print-hidden">
      <div className="app-header__logo">
        <CompanyBrand />
        <div className="header__pane ms-auto">
          <Hamburger
            className="close-sidebar-btn"
            active={closedSidebar}
            onClick={toggleSidebar}
            label={t("layout:header.toggleSidebar")}
          />
        </div>
      </div>
      <div className="app-header__mobile-menu">
        <Hamburger
          className="mobile-toggle-nav"
          active={mobileSidebarOpen}
          onClick={toggleMobileSidebar}
          label={t("layout:header.toggleSidebar")}
        />
      </div>
      <div className="app-header__menu">
        <span>
          <button
            type="button"
            className={cn(
              "btn-icon btn-icon-only btn btn-primary btn-sm mobile-toggle-header-nav",
              mobileHeaderOpen && "active"
            )}
            onClick={toggleMobileHeader}
            aria-label={t("layout:header.toggleMenu")}
          >
            <span className="btn-icon-wrapper">
              <IconDotsVertical size={16} />
            </span>
          </button>
        </span>
      </div>

      <div className={cn("app-header__content", mobileHeaderOpen && "header-mobile-open")}>
        <div className="app-header-left">
          <div className="search-wrapper" onClick={() => setOpen(true)}>
            <div className="input-holder">
              <input
                type="text"
                readOnly
                className="search-input"
                placeholder={t("common:actions.searchEllipsis")}
                aria-label={t("common:actions.search")}
              />
              <button type="button" className="search-icon" aria-label={t("common:actions.search")}>
                <span />
              </button>
            </div>
          </div>
          <ul className="header-menu nav">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.href} className="nav-item">
                <Link href={shortcut.href} className="nav-link gap-2">
                  <shortcut.icon size={16} className="nav-link-icon" />
                  {t(shortcut.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="app-header-right">
          <SyncIndicator status={syncStatus} />
          <LanguageSwitcher />
          <HeaderUser />
        </div>
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
    </div>
  );
}
