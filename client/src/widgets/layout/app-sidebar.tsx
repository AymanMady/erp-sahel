/**
 * Navigation sidebar.
 *
 * Ported from the OrbynAdmin design system to `wouter`: same visual structure
 * (groups, collapsible sub-menus, active states, collapsed mode), but driven by the
 * permissions and the modules actually enabled for the company.
 */

import { IconChevronRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";

import { useSession } from "@/shared/auth/session";
import { visibleNavGroups, type NavItem } from "@/shared/config/nav";
import { useThemeConfig } from "@/shared/components/theme-customizer";
import { useDirection } from "@/shared/i18n/direction-provider";
import { cn } from "@/shared/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/shared/ui/sidebar";
import { CompanySwitcher } from "./company-switcher";
import { NavUser } from "./nav-user";

export function AppSidebar() {
  const [pathname] = useLocation();
  const { config } = useThemeConfig();
  const { can, hasModule } = useSession();
  const groups = visibleNavGroups(can, hasModule);
  const direction = useDirection();
  const { t } = useTranslation("nav");

  return (
    <Sidebar
      side={direction === "rtl" ? "right" : "left"}
      collapsible={config.sidebarCollapsible}
      variant={config.sidebarVariant}
    >
      <SidebarHeader>
        <CompanySwitcher />
      </SidebarHeader>

      <SidebarContent className="overscroll-contain">
        {groups.map((group) => (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <NavEntry key={item.titleKey} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function badgeClass(badge: string) {
  return /^\d+$/.test(badge)
    ? "bg-sidebar-accent text-sidebar-accent-foreground"
    : "bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground";
}

function NavEntry({ item, pathname }: { item: NavItem; pathname: string }) {
  const { setOpenMobile } = useSidebar();
  const { t } = useTranslation("nav");
  const title = t(item.titleKey);
  const closeMobile = () => setOpenMobile(false);

  if (item.items?.length) {
    const childActive = item.items.some((child) => pathname.startsWith(child.url));
    return (
      <Collapsible asChild defaultOpen={childActive} className="group/collapsible">
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton tooltip={title} isActive={childActive}>
              {item.icon ? <item.icon className="size-4" /> : null}
              <span>{title}</span>
              {item.badge ? (
                <SidebarMenuBadge
                  className={cn(
                    "group-data-[state=open]/collapsible:hidden",
                    badgeClass(item.badge)
                  )}
                >
                  {item.badge}
                </SidebarMenuBadge>
              ) : null}
              <IconChevronRight className="ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 rtl:rotate-180" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden [--tw-animation-duration:260ms] data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <SidebarMenuSub>
              {item.items.map((child) => (
                <SidebarMenuSubItem key={child.titleKey}>
                  <SidebarMenuSubButton asChild isActive={pathname === child.url}>
                    <Link href={child.url} onClick={closeMobile}>
                      {t(child.titleKey)}
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  }

  // The root "/" must not stay active on every page: unlike other entries it
  // requires an exact match.
  const active =
    pathname === item.url || (item.url !== "/" && !!item.url && pathname.startsWith(item.url));

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={title}>
        <Link href={item.url ?? "#"} onClick={closeMobile}>
          {item.icon ? <item.icon className="size-4" /> : null}
          <span>{title}</span>
        </Link>
      </SidebarMenuButton>
      {item.badge ? (
        <SidebarMenuBadge className={badgeClass(item.badge)}>{item.badge}</SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}
