import { IconSearch, IconX } from "@tabler/icons-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher…",
  className,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cn("relative", className)}>
      <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="ps-9 pe-9"
        autoFocus={autoFocus}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Effacer la recherche"
          className="absolute end-1 top-1/2 size-7 -translate-y-1/2"
          onClick={() => onChange("")}
        >
          <IconX className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
