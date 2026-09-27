/**
 * Amount display, always in MRU (the only currency).
 *
 * The number format follows the UI language; `useTranslation()` subscribes these
 * components to language changes so they re-render when it switches.
 */

import { useTranslation } from "react-i18next";

import { formatMoney, formatQuantity, formatRate } from "@shared/money";
import { currentIntlLocale } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";

/** Formats an amount in cents, in MRU. */
export function useMoneyFormatter(): (cents: number, options?: { withSymbol?: boolean }) => string {
  useTranslation();
  return (cents, options) => formatMoney(cents, currentIntlLocale(), options);
}

export function Money({
  cents,
  className,
  withSymbol = true,
  tone,
}: {
  cents: number;
  className?: string;
  withSymbol?: boolean;
  /** `auto` colors negative amounts red (cash discrepancies, credit notes). */
  tone?: "auto" | "muted";
}) {
  useTranslation();
  const negative = cents < 0;
  return (
    <span
      className={cn(
        "tabular",
        tone === "muted" && "text-muted-foreground",
        tone === "auto" && negative && "text-status-danger",
        className
      )}
    >
      {formatMoney(cents, currentIntlLocale(), { withSymbol })}
    </span>
  );
}

export function Quantity({ value, className }: { value: string | number; className?: string }) {
  useTranslation();
  return <span className={cn("tabular", className)}>{formatQuantity(value)}</span>;
}

export function Rate({ bp, className }: { bp: number; className?: string }) {
  useTranslation();
  return <span className={cn("tabular", className)}>{formatRate(bp)}</span>;
}
