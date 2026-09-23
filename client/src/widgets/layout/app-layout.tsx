/**
 * Coquille applicative : barre latérale, en-tête, bandeau hors-ligne et contenu.
 *
 * C'est ici que le moteur de synchronisation est monté : il tourne tant que
 * l'utilisateur est connecté, quel que soit l'écran affiché.
 */

import type { ReactNode } from "react";

import { useSyncEngine } from "@/shared/hooks/use-sync";
import { ThemeCustomizer } from "@/shared/components/theme-customizer";
import { SidebarInset, SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { OfflineBanner } from "./sync-indicator";

export function AppLayout({ children }: { children: ReactNode }) {
  const syncStatus = useSyncEngine(true);

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <OfflineBanner />
          <AppHeader syncStatus={syncStatus} />
          <main className="app-main min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
        <ThemeCustomizer />
      </SidebarProvider>
    </TooltipProvider>
  );
}

/**
 * Coquille plein écran du point de vente : ni barre latérale ni en-tête, pour
 * maximiser la surface utile sur un écran de caisse (souvent petit et tactile).
 */
export function FullscreenLayout({ children }: { children: ReactNode }) {
  useSyncEngine(true);
  return (
    <TooltipProvider delayDuration={0}>
      <div className="pos-shell flex flex-col bg-background">
        <OfflineBanner />
        {children}
      </div>
    </TooltipProvider>
  );
}
