import type { ReactNode } from "react";
import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { currentIntlLocale } from "@/shared/i18n";
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
  /**
   * ArchitectUI gradient widget (white text on a colored background); without it,
   * the card stays plain.
   */
  tone?: StatTone;
}

export type StatTone = "green" | "blue" | "gold" | "violet" | "red";

/** Gradient backgrounds of the ArchitectUI template (`utils/_backgrounds.scss`). */
const TONE_CLASS: Record<StatTone, string> = {
  green: "bg-grow-early",
  blue: "bg-arielle-smile",
  gold: "bg-premium-dark",
  violet: "bg-midnight-bloom",
  red: "bg-love-kiss",
};

export function StatCard({
  label,
  value,
  change,
  hint,
  icon,
  loading,
  invertTrend,
  tone,
}: StatCardProps) {
  // Subscribes to language changes (percentage format).
  useTranslation();
  const hasChange = typeof change === "number" && Number.isFinite(change);
  const rising = hasChange && change > 0;
  const favourable = invertTrend ? !rising : rising;

  const trend =
    hasChange && change !== 0 ? (
      <span
        className={cn(
          "badge ms-2 inline-flex items-center gap-1",
          tone ? "bg-white/25" : favourable ? "bg-success" : "bg-danger"
        )}
      >
        {rising ? <IconTrendingUp className="size-3" /> : <IconTrendingDown className="size-3" />}
        {new Intl.NumberFormat(currentIntlLocale(), {
          style: "percent",
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(Math.abs(change) / 100)}
      </span>
    ) : null;

  // ArchitectUI dashboard widget (`dashboard-example-1.hbs`): heading and
  // sub-heading on one side, the figure on the other.
  return (
    <div className={cn("card mb-0 widget-content h-full", tone && TONE_CLASS[tone])}>
      <div className={cn("widget-content-wrapper flex-wrap gap-3", tone && "text-white")}>
        {icon ? (
          <div className="widget-content-left me-1">
            <span
              className={cn(
                "flex size-11 items-center justify-center rounded-full",
                tone ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
              )}
            >
              {icon}
            </span>
          </div>
        ) : null}
        <div className="widget-content-left min-w-0">
          <div className="widget-heading">{label}</div>
          {hint ? <div className="widget-subheading">{hint}</div> : null}
        </div>
        <div className="widget-content-right ms-auto text-end">
          {loading ? (
            <Skeleton className={cn("h-8 w-28", tone && "bg-white/25")} />
          ) : (
            <div
              className={cn(
                "widget-numbers tabular whitespace-nowrap",
                tone === "gold" ? "text-warning" : tone ? "text-white" : "text-primary"
              )}
            >
              <span>{value}</span>
            </div>
          )}
          {trend}
        </div>
      </div>
    </div>
  );
}
