/**
 * Page title band, in the ArchitectUI style: an icon tile, the title and its
 * sub-heading, and the page actions on the opposite side.
 *
 * The icon is derived from the navigation entry matching the current URL, so every
 * screen gets one without having to pass it.
 */

import type { Icon } from "@tabler/icons-react";
import { useLocation } from "wouter";

import { navIconForPath } from "@/shared/config/nav";
import { cn } from "@/shared/lib/utils";

export function PageHeader({
  title,
  description,
  icon,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** Overrides the icon derived from the menu. */
  icon?: Icon;
  children?: React.ReactNode;
  className?: string;
}) {
  const [pathname] = useLocation();
  const PageIcon = icon ?? navIconForPath(pathname);

  return (
    <div
      className={cn(
        "app-page-title flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        {PageIcon ? (
          <div className="page-title-icon max-sm:hidden">
            <PageIcon className="size-7" stroke={1.5} />
          </div>
        ) : null}
        <div className="min-w-0 space-y-0.5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2 [&_[data-slot=button]]:h-9">
          {children}
        </div>
      )}
    </div>
  );
}
