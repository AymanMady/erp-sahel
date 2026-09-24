/** Propagates the text direction (RTL for Arabic) to Radix primitives. */

import type { ReactNode } from "react";
import { Direction } from "radix-ui";
import { useTranslation } from "react-i18next";

import { languageInfo } from "./languages";

export function DirectionProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  return <Direction.Provider dir={languageInfo(i18n.language).dir}>{children}</Direction.Provider>;
}

/** Current text direction, for components that position themselves (sidebar, toasts). */
export function useDirection() {
  const { i18n } = useTranslation();
  return languageInfo(i18n.language).dir;
}
