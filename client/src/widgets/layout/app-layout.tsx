/**
 * Application shell: sidebar, header, offline banner and content.
 *
 * This is where the sync engine is mounted: it runs as long as the user is signed
 * in, whatever screen is displayed.
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
 * Full-screen point-of-sale shell: no sidebar nor header, to maximize the usable
 * area on a checkout screen (often small and touch-based).
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
