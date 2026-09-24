import type { ReactNode } from "react";
import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { currentIntlLocale } from "@/shared/i18n";
import { Card, CardContent } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Change in percent; when omitted, no trend badge is shown. */
  change?: number | null;
  hint?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  /**
   * Inverts how the trend reads: for an expense or an unpaid amount, a rise is not
   * good news.
   */
  invertTrend?: boolean;
}

export function StatCard({
  label,
  value,
  change,
  hint,
  icon,
  loading,
  invertTrend,
}: StatCardProps) {
  // Subscribes to language changes (percentage format).
  useTranslation();
  const hasChange = typeof change === "number" && Number.isFinite(change);
  const rising = hasChange && change > 0;
  const favourable = invertTrend ? !rising : rising;

  return (
    <Card>
      <CardContent className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        </div>
        <div className="flex items-end justify-between gap-2">
          {loading ? (
            <Skeleton className="h-9 w-32" />
          ) : (
            <span className="tabular text-3xl font-semibold tracking-tight">{value}</span>
          )}
          {hasChange && change !== 0 ? (
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                favourable
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              )}
            >
              {rising ? (
                <IconTrendingUp className="size-3.5" />
              ) : (
                <IconTrendingDown className="size-3.5" />
              )}
              {new Intl.NumberFormat(currentIntlLocale(), {
                style: "percent",
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format(Math.abs(change) / 100)}
            </span>
          ) : null}
        </div>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
