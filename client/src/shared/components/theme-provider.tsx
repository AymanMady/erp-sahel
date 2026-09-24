import type { ComponentProps } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light/dark theme.
 *
 * `next-themes` does not depend on Next.js: it sets the `dark` class on `<html>` and
 * handles the system preference. Transitions are disabled on theme change to avoid a
 * whole-page fade on an underpowered checkout device.
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
