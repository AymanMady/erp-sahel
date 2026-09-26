import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/shared/lib/utils";

/**
 * ArchitectUI / Bootstrap 5 buttons (`btn btn-primary`, `btn-sm`…). The Tailwind
 * part only lays out the icon next to the label.
 */
const buttonVariants = cva(
  "btn group/button inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "btn-primary",
        outline: "btn-outline-secondary",
        secondary: "btn-light",
        ghost: "btn-ghost",
        destructive: "btn-danger",
        link: "btn-link",
      },
      size: {
        default: "",
        xs: "btn-sm px-2 py-0.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "btn-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "btn-lg",
        icon: "btn-icon-only size-9 p-0",
        "icon-xs": "btn-icon-only size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "btn-icon-only size-7 p-0",
        "icon-lg": "btn-icon-only size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
