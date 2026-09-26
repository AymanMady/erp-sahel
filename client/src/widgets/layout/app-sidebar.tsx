/**
 * Navigation sidebar, with the ArchitectUI template markup (`AppSidebar/sidebar.hbs`):
 * `.vertical-nav-menu` with section headings and collapsible sub-menus. React state
 * replaces the template's metisMenu jQuery plugin (`mm-active` / `mm-show`).
 *
 * Entries are driven by the permissions and the modules enabled for the company.
 */

import { useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";

import { useSession } from "@/shared/auth/session";
import { visibleNavGroups, type NavItem } from "@/shared/config/nav";
import { cn } from "@/shared/lib/utils";
import { useLayoutState } from "./layout-state";

export function AppSidebar() {
  const [pathname] = useLocation();
  const { can, hasModule } = useSession();
  const groups = visibleNavGroups(can, hasModule);
  const { t } = useTranslation("nav");

  return (
    <div className="app-sidebar sidebar-shadow print-hidden">
      <div className="scrollbar-sidebar">
        <div className="app-sidebar__inner">
          <ul className="vertical-nav-menu">
            {groups.map((group) => (
              <SidebarGroup key={group.labelKey} heading={t(group.labelKey)}>
                {group.items.map((item) => (
                  <NavEntry key={item.titleKey} item={item} pathname={pathname} />
                ))}
              </SidebarGroup>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SidebarGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <>
      <li className="app-sidebar__heading">{heading}</li>
      {children}
    </>
  );
}

/** The root "/" must not stay active on every page: it requires an exact match. */
function isActive(pathname: string, url: string | undefined) {
  if (!url) return false;
  return pathname === url || (url !== "/" && pathname.startsWith(`${url}/`));
}

function NavEntry({ item, pathname }: { item: NavItem; pathname: string }) {
  const { t } = useTranslation("nav");
  const { closeMobileSidebar } = useLayoutState();
  const childActive = item.items?.some((child) => isActive(pathname, child.url)) ?? false;
  const [open, setOpen] = useState(childActive);
  const Icon = item.icon;
  const icon = <i className="metismenu-icon">{Icon ? <Icon stroke={1.5} /> : null}</i>;

  if (item.items?.length) {
    return (
      <li className={cn(open && "mm-active")}>
        <a
          role="button"
          tabIndex={0}
          aria-expanded={open}
          className={cn(childActive && !open && "mm-active")}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen((value) => !value);
            }
          }}
        >
          {icon}
          {t(item.titleKey)}
          <i className="metismenu-state-icon caret-left">
            <IconChevronDown />
          </i>
        </a>
        <ul className={cn("mm-collapse", open && "mm-show")}>
          {item.items.map((child) => {
            // The longest matching sub-entry wins (`/inventory` vs `/inventory/movements`).
            const active =
              isActive(pathname, child.url) &&
              !item.items?.some(
                (other) => other.url.length > child.url.length && isActive(pathname, other.url)
              );
            return (
              <li key={child.titleKey}>
                <Link
                  href={child.url}
                  className={cn(active && "mm-active")}
                  onClick={closeMobileSidebar}
                >
                  <i className="metismenu-icon" />
                  {t(child.titleKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.url ?? "#"}
        className={cn(isActive(pathname, item.url) && "mm-active")}
        onClick={closeMobileSidebar}
      >
        {icon}
        {t(item.titleKey)}
        {item.badge ? (
          <span className="badge rounded-pill bg-primary ms-auto">{item.badge}</span>
        ) : null}
      </Link>
    </li>
  );
}
