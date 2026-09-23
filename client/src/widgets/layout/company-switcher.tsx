/**
 * Sélecteur de société (multi-tenant).
 *
 * Changer de société réémet un jeton portant la nouvelle `companyId` : l'ensemble des
 * requêtes suivantes est donc cloisonné côté serveur, et le cache client est vidé pour
 * qu'aucune donnée de l'ancienne société ne subsiste à l'écran ([BR-13]).
 */

import { useState } from "react";
import { IconCheck, IconSelector } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useSession } from "@/shared/auth/session";
import { brandIcon as BrandIcon } from "@/shared/config/nav";
import { errorMessage } from "@/shared/api/api-error";
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
  const { company, companies, switchCompany } = useSession();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState(false);

  const handleSwitch = async (companyId: string) => {
    if (companyId === company?.id || switching) return;
    setSwitching(true);
    try {
      await switchCompany(companyId);
      // Le cache contient des données de l'ancienne société : on le vide entièrement.
      queryClient.clear();
      toast.success("Société changée.");
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
      <div className="grid flex-1 text-left leading-tight">
        <span className="truncate font-semibold tracking-tight">
          {company?.name ?? "ERP Sahel"}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {company ? `Devise ${company.currency}` : "Chargement…"}
        </span>
      </div>
      {companies.length > 1 ? (
        <IconSelector className="ml-auto size-4 text-muted-foreground" />
      ) : null}
    </SidebarMenuButton>
  );

  // Une seule société : le menu déroulant n'apporterait rien, on affiche l'enseigne.
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
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Sociétés
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
