/** Fournisseurs globaux : thème, requêtes, session, notifications. */

import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@/shared/api/query-client";
import { SessionProvider } from "@/shared/auth/session";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { ThemeConfigProvider } from "@/shared/components/theme-customizer";
import { Toaster } from "@/shared/ui/sonner";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ThemeConfigProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            {children}
            <Toaster position="top-right" richColors closeButton />
          </SessionProvider>
        </QueryClientProvider>
      </ThemeConfigProvider>
    </ThemeProvider>
  );
}
