import * as React from "react";

import { cn } from "@/shared/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("form-control field-sizing-content min-h-16", className)}
      {...props}
    />
  );
}

export { Textarea };
