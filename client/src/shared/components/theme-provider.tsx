import type { ComponentProps } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Thème clair/sombre.
 *
 * `next-themes` ne dépend pas de Next.js : il pose la classe `dark` sur `<html>` et
 * gère la préférence système. On désactive la transition au changement de thème pour
 * éviter un fondu de toute la page sur un poste de caisse peu puissant.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="erp.theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
