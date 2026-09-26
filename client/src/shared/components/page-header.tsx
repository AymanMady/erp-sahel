/**
 * Page title, with the ArchitectUI template markup (`AppMain/page-title.hbs`): icon
 * tile, title with its sub-heading, and the page actions (`.page-title-actions`).
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
    <div className={cn("app-page-title", className)}>
      <div className="page-title-wrapper flex-wrap gap-y-3">
        <div className="page-title-heading min-w-0">
          {PageIcon ? (
            <div className="page-title-icon max-sm:hidden">
              <PageIcon size={30} stroke={1.5} />
            </div>
          ) : null}
          <div className="min-w-0">
            <h1 className="fs-5 fw-normal mb-0">{title}</h1>
            {description ? <div className="page-title-subheading">{description}</div> : null}
          </div>
        </div>
        {children ? (
          <div className="page-title-actions flex flex-wrap items-center gap-2">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
