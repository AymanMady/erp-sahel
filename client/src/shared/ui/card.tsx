import * as React from "react";

import { cn } from "@/shared/lib/utils";

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn("main-card card group/card overflow-hidden", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "card-body group/card-header @container/card-header grid auto-rows-min items-start gap-1 pb-0 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--bs-card-spacer-y) [&+[data-slot=card-content]]:pt-3",
        className
      )}
      {...props}
    />
  );
}

/**
 * ArchitectUI header bar (`.card-header`): uppercase title with an optional icon,
 * actions pushed to the other end (`.btn-actions-pane-right`).
 */
function CardHeaderBar({
  className,
  icon,
  title,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
}) {
  return (
    <div
      data-slot="card-header-bar"
      className={cn("card-header-tab card-header gap-2", className)}
      {...props}
    >
      <div className="card-header-title flex min-w-0 items-center gap-2">
        {icon ? <span className="text-primary opacity-75 [&_svg]:size-5">{icon}</span> : null}
        <span className="truncate">{title}</span>
      </div>
      {children ? (
        <div className="btn-actions-pane-right flex items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("card-title mb-0 border-0 p-0", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground opacity-75", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("card-body", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("card-footer flex items-center", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardHeaderBar,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
