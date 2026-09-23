/**
 * Barre latérale de navigation.
 *
 * Portée du design system OrbynAdmin vers `wouter` : même structure visuelle
 * (groupes, sous-menus repliables, états actifs, mode réduit), mais alimentée par les
 * permissions et les modules réellement actifs pour la société.
 */

import { IconChevronRight } from "@tabler/icons-react";
import { Link, useLocation } from "wouter";

import { useSession } from "@/shared/auth/session";
import { visibleNavGroups, type NavItem } from "@/shared/config/nav";
import { useThemeConfig } from "@/shared/components/theme-customizer";
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

  return (
    <Sidebar collapsible={config.sidebarCollapsible} variant={config.sidebarVariant}>
      <SidebarHeader>
        <CompanySwitcher />
      </SidebarHeader>

      <SidebarContent className="overscroll-contain">
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <NavEntry key={item.title} item={item} pathname={pathname} />
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
  const closeMobile = () => setOpenMobile(false);

  if (item.items?.length) {
    const childActive = item.items.some((child) => pathname.startsWith(child.url));
    return (
      <Collapsible asChild defaultOpen={childActive} className="group/collapsible">
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton tooltip={item.title} isActive={childActive}>
              {item.icon ? <item.icon className="size-4" /> : null}
              <span>{item.title}</span>
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
              <IconChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden [--tw-animation-duration:260ms] data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <SidebarMenuSub>
              {item.items.map((child) => (
                <SidebarMenuSubItem key={child.title}>
                  <SidebarMenuSubButton asChild isActive={pathname === child.url}>
                    <Link href={child.url} onClick={closeMobile}>
                      {child.title}
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

  // La racine « / » ne doit pas rester active sur toutes les pages : elle exige
  // une correspondance exacte, contrairement aux autres entrées.
  const active =
    pathname === item.url || (item.url !== "/" && !!item.url && pathname.startsWith(item.url));

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
        <Link href={item.url ?? "#"} onClick={closeMobile}>
          {item.icon ? <item.icon className="size-4" /> : null}
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {item.badge ? (
        <SidebarMenuBadge className={badgeClass(item.badge)}>{item.badge}</SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}
