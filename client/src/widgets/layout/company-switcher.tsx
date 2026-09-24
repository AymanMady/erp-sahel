/**
 * Company switcher (multi-tenant).
 *
 * Switching company re-issues a token carrying the new `companyId`: every following
 * request is therefore isolated server-side, and the client cache is cleared so that
 * no data of the previous company remains on screen ([BR-13]).
 */

import { useState } from "react";
import { IconCheck, IconSelector } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSession } from "@/shared/auth/session";
import { brandIcon as BrandIcon } from "@/shared/config/nav";
import { errorMessage } from "@/shared/api/api-error";
import { useDirection } from "@/shared/i18n/direction-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/shared/ui/sidebar";

export function CompanySwitcher() {
  const { isMobile } = useSidebar();
  const direction = useDirection();
  const { company, companies, switchCompany } = useSession();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState(false);
  const { t } = useTranslation("layout");

  const handleSwitch = async (companyId: string) => {
    if (companyId === company?.id || switching) return;
    setSwitching(true);
    try {
      await switchCompany(companyId);
      // The cache holds data of the previous company: clear it entirely.
      queryClient.clear();
      toast.success(t("companySwitcher.switched"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSwitching(false);
    }
  };

  const trigger = (
    <SidebarMenuButton
      size="lg"
      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
    >
      <div className="flex aspect-square size-9 items-center justify-center overflow-hidden rounded-lg bg-primary text-primary-foreground">
        {company?.logo ? (
          <img src={company.logo} alt="" className="size-full object-cover" />
        ) : (
          <BrandIcon className="size-5" />
        )}
      </div>
      <div className="grid flex-1 text-start leading-tight">
        <span className="truncate font-semibold tracking-tight">
          {company?.name ?? t("common:appName")}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {company
            ? t("companySwitcher.currency", { currency: company.currency })
            : t("common:states.loading")}
        </span>
      </div>
      {companies.length > 1 ? (
        <IconSelector className="ms-auto size-4 text-muted-foreground" />
      ) : null}
    </SidebarMenuButton>
  );

  // A single company: a dropdown would add nothing, just show the brand.
  if (companies.length <= 1) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>{trigger}</SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : direction === "rtl" ? "left" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t("companySwitcher.companies")}
            </DropdownMenuLabel>
            {companies.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onClick={() => void handleSwitch(entry.id)}
                className="gap-2 p-2"
                disabled={switching}
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <BrandIcon className="size-3.5 shrink-0" />
                </div>
                <div className="grid flex-1 leading-tight">
                  <span className="truncate text-sm font-medium">{entry.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{entry.subdomain}</span>
                </div>
                {company?.id === entry.id ? <IconCheck className="size-4 shrink-0" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
