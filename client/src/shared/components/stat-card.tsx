import type { ReactNode } from "react";
import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";

import { Card, CardContent } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Variation en pourcentage ; omise, aucun badge de tendance n'est affiché. */
  change?: number | null;
  hint?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  /**
   * Inverse la lecture de la tendance : pour une dépense ou un impayé, une hausse
   * n'est pas une bonne nouvelle.
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
              {Math.abs(change).toFixed(1)} %
            </span>
          ) : null}
        </div>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
