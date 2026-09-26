import type { ComponentProps } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme: always light, the ArchitectUI template having no dark variant.
 *
 * `next-themes` is kept because some components (toasts) read the theme from it.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      forcedTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="erp.theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
