/** Gestion des équivalences OEM (relation symétrique et transitive). */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "@/shared/api/api-error";
import { autoPartsApi, type OemEquivalenceRow } from "@/entities/modules/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

export default function EquivalencesPage() {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(search);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.autoParts.equivalences(debounced || undefined),
    queryFn: () => autoPartsApi.listEquivalences(debounced || undefined),
  });

  const remove = useMutation({
    mutationFn: (id: string) => autoPartsApi.deleteEquivalence(id),
    onSuccess: () => {
      toast.success("Équivalence supprimée.");
      void queryClient.invalidateQueries({ queryKey: ["ap", "equivalences"] });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const columns: Column<OemEquivalenceRow>[] = [
    {
      id: "refA",
      header: "Référence",
      cell: (row) => <span className="tabular font-medium">{row.refA}</span>,
    },
    {
      id: "arrow",
      header: "",
      align: "center",
      cell: () => <span className="text-muted-foreground">↔</span>,
    },
    {
      id: "refB",
      header: "Équivalente",
      cell: (row) => <span className="tabular font-medium">{row.refB}</span>,
    },
    {
      id: "type",
      header: "Type",
      hideOnMobile: true,
      cell: (row) => (
        <Badge variant="outline">
          {row.relationType === "OEM_OEM" ? "OEM ↔ OEM" : "OEM ↔ Aftermarket"}
        </Badge>
      ),
    },
    {
      id: "source",
      header: "Source",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.source || "—"}</span>,
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        can("auto_parts.write") ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Supprimer"
            onClick={() => remove.mutate(row.id)}
          >
            <IconTrash className="size-4" />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Équivalences OEM"
        description="La relation est symétrique et transitive : déclarer A ↔ B et B ↔ C rend A et C équivalentes."
      >
        {can("auto_parts.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            Nouvelle équivalence
          </Button>
        ) : null}
      </PageHeader>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Filtrer par référence…"
        className="sm:max-w-sm"
      />

      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucune équivalence"
        emptyDescription="Déclarez les références interchangeables pour que la recherche les retrouve toutes."
      />

      <EquivalenceDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function EquivalenceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    refA: "",
    refB: "",
    relationType: "OEM_OEM",
    source: "",
    note: "",
  });

  const mutation = useMutation({
    mutationFn: () => autoPartsApi.createEquivalence(form),
    onSuccess: () => {
      toast.success("Équivalence enregistrée.");
      void queryClient.invalidateQueries({ queryKey: ["ap", "equivalences"] });
      onOpenChange(false);
      setForm({ refA: "", refB: "", relationType: "OEM_OEM", source: "", note: "" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle équivalence</DialogTitle>
          <DialogDescription>
            Inutile de déclarer une relation déjà impliquée par transitivité : elle sera refusée.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label="Référence A" required>
              <Input
                value={form.refA}
                onChange={(event) => setForm({ ...form, refA: event.target.value })}
                required
                className="tabular"
                autoFocus
              />
            </Field>
            <Field label="Référence B" required>
              <Input
                value={form.refB}
                onChange={(event) => setForm({ ...form, refB: event.target.value })}
                required
                className="tabular"
              />
            </Field>
          </FieldGrid>
          <Field label="Type de relation">
            <Select
              value={form.relationType}
              onValueChange={(value) => setForm({ ...form, relationType: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OEM_OEM">OEM ↔ OEM</SelectItem>
                <SelectItem value="OEM_AFTERMARKET">OEM ↔ Aftermarket</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Source" hint="Catalogue constructeur, fiche fournisseur…">
            <Input
              value={form.source}
              onChange={(event) => setForm({ ...form, source: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !form.refA.trim() || !form.refB.trim()}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
