/**
 * Application shell, with the ArchitectUI template markup (`layout/base.hbs`):
 * fixed header, fixed sidebar, page and footer.
 *
 * This is where the sync engine is mounted: it runs as long as the user is signed
 * in, whatever screen is displayed.
 */

import type { ReactNode } from "react";

import { useSyncEngine } from "@/shared/hooks/use-sync";
import { cn } from "@/shared/lib/utils";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { LayoutStateProvider, useLayoutState } from "./layout-state";
import { OfflineBanner } from "./sync-indicator";

export function AppLayout({ children }: { children: ReactNode }) {
  const syncStatus = useSyncEngine(true);

  return (
    <TooltipProvider delayDuration={0}>
      <LayoutStateProvider>
        <AppContainer>
          <AppHeader syncStatus={syncStatus} />
          <div className="app-main">
            <AppSidebar />
            <SidebarOverlay />
            <div className="app-main__outer min-w-0">
              <OfflineBanner />
              <main className="app-main__inner min-w-0">{children}</main>
              <AppFooter syncStatus={syncStatus} />
            </div>
          </div>
        </AppContainer>
      </LayoutStateProvider>
    </TooltipProvider>
  );
}

function AppContainer({ children }: { children: ReactNode }) {
  const { closedSidebar, mobileSidebarOpen } = useLayoutState();
  return (
    <div
      className={cn(
        "app-container app-theme-white body-tabs-shadow fixed-sidebar fixed-header",
        closedSidebar && "closed-sidebar",
        mobileSidebarOpen && "sidebar-mobile-open"
      )}
    >
      {children}
    </div>
  );
}

/**
 * Dims the page behind the open mobile menu; a tap closes it. It lives inside
 * `.app-main`, next to the sidebar: `.app-main` is its own stacking context, so an
 * overlay placed outside it would cover the sidebar and swallow every tap on it.
 */
function SidebarOverlay() {
  const { closeMobileSidebar } = useLayoutState();
  return <div className="sidebar-mobile-overlay" onClick={closeMobileSidebar} aria-hidden />;
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
