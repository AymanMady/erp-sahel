/** Global providers: theme, text direction, queries, session, notifications. */

import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@/shared/api/query-client";
import { SessionProvider } from "@/shared/auth/session";
import { DirectionProvider, useDirection } from "@/shared/i18n/direction-provider";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { ThemeConfigProvider } from "@/shared/components/theme-customizer";
import { Toaster } from "@/shared/ui/sonner";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <DirectionProvider>
      <ThemeProvider>
        <ThemeConfigProvider>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              {children}
              <AppToaster />
            </SessionProvider>
          </QueryClientProvider>
        </ThemeConfigProvider>
      </ThemeProvider>
    </DirectionProvider>
  );
}

/** Toasts on the reading-end side of the screen (left in Arabic). */
function AppToaster() {
  const direction = useDirection();
  return (
    <Toaster
      position={direction === "rtl" ? "top-left" : "top-right"}
      dir={direction}
      richColors
      closeButton
    />
  );
}
