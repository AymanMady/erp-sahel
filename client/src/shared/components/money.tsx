/** Affichage des montants, toujours dans la devise de la société courante. */

import { formatMoney, formatQuantity, formatRate } from "@shared/money";
import { useSession } from "@/shared/auth/session";
import { cn } from "@/shared/lib/utils";

export function useCurrency(): string {
  return useSession().company?.currency ?? "MRU";
}

/** Formate un montant en centimes avec la devise de la société. */
export function useMoneyFormatter(): (cents: number, options?: { withSymbol?: boolean }) => string {
  const currency = useCurrency();
  return (cents, options) => formatMoney(cents, currency, "fr-FR", options);
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
  /** `auto` colore les montants négatifs en rouge (écarts de caisse, avoirs). */
  tone?: "auto" | "muted";
}) {
  const currency = useCurrency();
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
      {formatMoney(cents, currency, "fr-FR", { withSymbol })}
    </span>
  );
}

export function Quantity({ value, className }: { value: string | number; className?: string }) {
  return <span className={cn("tabular", className)}>{formatQuantity(value)}</span>;
}

export function Rate({ bp, className }: { bp: number; className?: string }) {
  return <span className={cn("tabular", className)}>{formatRate(bp)}</span>;
}
