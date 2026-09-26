/**
 * State of the ArchitectUI shell, in place of the template's jQuery script
 * (`app.js` / `demo.js`): collapsed sidebar, mobile menu and mobile header menu.
 *
 * As in the template, the sidebar collapses by itself below 1250px wide.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

/** Width under which the template collapses the sidebar (`resizeClass` in `app.js`). */
const COLLAPSE_BELOW = 1250;

interface LayoutState {
  closedSidebar: boolean;
  toggleSidebar: () => void;
  mobileSidebarOpen: boolean;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  mobileHeaderOpen: boolean;
  toggleMobileHeader: () => void;
}

const LayoutContext = createContext<LayoutState | null>(null);

function isNarrow() {
  return typeof window !== "undefined" && window.innerWidth < COLLAPSE_BELOW;
}

export function LayoutStateProvider({ children }: { children: ReactNode }) {
  const [pathname] = useLocation();
  const [closedSidebar, setClosedSidebar] = useState(isNarrow);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileHeaderOpen, setMobileHeaderOpen] = useState(false);

  useEffect(() => {
    let narrow = isNarrow();
    const onResize = () => {
      // Only react when crossing the threshold, so a manual choice is kept.
      if (isNarrow() !== narrow) {
        narrow = isNarrow();
        setClosedSidebar(narrow);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Changing screen closes the mobile menus.
  useEffect(() => {
    setMobileSidebarOpen(false);
    setMobileHeaderOpen(false);
  }, [pathname]);

  const value = useMemo<LayoutState>(
    () => ({
      closedSidebar,
      toggleSidebar: () => setClosedSidebar((value) => !value),
      mobileSidebarOpen,
      toggleMobileSidebar: () => setMobileSidebarOpen((value) => !value),
      closeMobileSidebar: () => setMobileSidebarOpen(false),
      mobileHeaderOpen,
      toggleMobileHeader: () => setMobileHeaderOpen((value) => !value),
    }),
    [closedSidebar, mobileSidebarOpen, mobileHeaderOpen]
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayoutState(): LayoutState {
  const context = useContext(LayoutContext);
  if (!context) throw new Error("useLayoutState must be used inside <LayoutStateProvider>.");
  return context;
}
