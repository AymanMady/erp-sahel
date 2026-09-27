/** Global providers: theme, text direction, queries, session, notifications. */

import { useEffect, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { onConnectivityChange } from "@/shared/api/network";
import { queryClient } from "@/shared/api/query-client";
import { SessionProvider } from "@/shared/auth/session";
import { DirectionProvider, useDirection } from "@/shared/i18n/direction-provider";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { Toaster } from "@/shared/ui/sonner";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <DirectionProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <RefetchOnReconnect />
            {children}
            <AppToaster />
          </SessionProvider>
        </QueryClientProvider>
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

/**
 * When the server answers again, screens left in error (dashboard, lists) reload
 * by themselves: the user does not have to press "Retry". The browser's own
 * `online` event is not enough — it misses a server that comes back while the
 * Wi-Fi never dropped.
 */
function RefetchOnReconnect() {
  useEffect(
    () =>
      onConnectivityChange((online) => {
        if (!online) return;
        void queryClient.refetchQueries({
          type: "active",
          predicate: (query) => query.state.status === "error",
        });
      }),
    []
  );
  return null;
}
