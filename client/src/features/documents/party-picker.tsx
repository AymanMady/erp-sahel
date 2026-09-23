/** Sélecteur de tiers (client ou fournisseur) avec recherche serveur et création rapide. */

import { useState } from "react";
import { IconChevronDown, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { partyApi } from "@/entities/party/api";
import type { Party } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { SearchInput } from "@/shared/components/search-input";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { PartyDialog } from "@/pages/parties/list";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { ScrollArea } from "@/shared/ui/scroll-area";

export function PartyPicker({
  value,
  onChange,
  role = "CUSTOMER",
  placeholder = "Sélectionner un client",
  disabled,
}: {
  value: Party | null;
  onChange: (party: Party | null) => void;
  role?: "CUSTOMER" | "SUPPLIER";
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const { can } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.parties({ picker: debounced, role }),
    queryFn: () => partyApi.list({ search: debounced || undefined, role, limit: 30 }),
    enabled: open,
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between font-normal"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <span className={value ? "" : "text-muted-foreground"}>{value?.name ?? placeholder}</span>
        <IconChevronDown className="size-4 opacity-50" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {role === "SUPPLIER" ? "Choisir un fournisseur" : "Choisir un client"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex gap-2">
            <SearchInput value={search} onChange={setSearch} className="flex-1" autoFocus />
            {can("parties.write") ? (
              <Button
                variant="outline"
                size="icon"
                aria-label="Nouveau tiers"
                onClick={() => setCreating(true)}
              >
                <IconPlus className="size-4" />
              </Button>
            ) : null}
          </div>

          <ScrollArea className="max-h-80">
            <div className="space-y-1">
              {(data?.items ?? []).map((party) => (
                <button
                  key={party.id}
                  type="button"
                  className="w-full rounded-md px-3 py-2 text-start transition-colors hover:bg-muted"
                  onClick={() => {
                    onChange(party);
                    setOpen(false);
                  }}
                >
                  <p className="text-sm font-medium">{party.name}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {party.code}
                    {party.phone ? ` · ${party.phone}` : ""}
                  </p>
                </button>
              ))}
              {(data?.items.length ?? 0) === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Aucun tiers trouvé.
                </p>
              ) : null}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <PartyDialog
        open={creating}
        onOpenChange={setCreating}
        defaultType={role}
        onCreated={(party) => {
          onChange(party);
          setOpen(false);
        }}
      />
    </>
  );
}
