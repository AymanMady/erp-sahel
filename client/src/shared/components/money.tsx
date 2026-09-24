/**
 * Amount display, always in the current company's currency.
 *
 * The number format follows the UI language; `useTranslation()` subscribes these
 * components to language changes so they re-render when it switches.
 */

import { useTranslation } from "react-i18next";

import { formatMoney, formatQuantity, formatRate } from "@shared/money";
import { currentIntlLocale } from "@/shared/i18n";
import { useSession } from "@/shared/auth/session";
import { cn } from "@/shared/lib/utils";

export function useCurrency(): string {
  return useSession().company?.currency ?? "MRU";
}

/** Formats an amount in cents with the company currency. */
export function useMoneyFormatter(): (cents: number, options?: { withSymbol?: boolean }) => string {
  const currency = useCurrency();
  useTranslation();
  return (cents, options) => formatMoney(cents, currency, currentIntlLocale(), options);
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
  const currency = useCurrency();
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
      {formatMoney(cents, currency, currentIntlLocale(), { withSymbol })}
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
