/** Sidebar header: the company's logo, name and currency. */

import { useTranslation } from "react-i18next";

import { useSession } from "@/shared/auth/session";
import { brandIcon as BrandIcon } from "@/shared/config/nav";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/shared/ui/sidebar";

export function CompanyBrand() {
  const { company } = useSession();
  const { t } = useTranslation("layout");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="pointer-events-none">
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
                ? t("companyBrand.currency", { currency: company.currency })
                : t("common:states.loading")}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
