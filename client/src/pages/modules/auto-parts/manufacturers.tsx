/** Fabricants / équipementiers — distincts des marques de véhicules ([FR-FAB-1]). */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "@/shared/api/api-error";
import { autoPartsApi, type Manufacturer } from "@/entities/modules/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const NONE = "NONE";

export default function ManufacturersPage() {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.autoParts.manufacturers,
    queryFn: () => autoPartsApi.listManufacturers(),
  });
  const { data: countries } = useQuery({
    queryKey: queryKeys.autoParts.countries,
    queryFn: () => autoPartsApi.listCountries(),
  });

  const archive = useMutation({
    mutationFn: (id: string) => autoPartsApi.archiveManufacturer(id),
    onSuccess: () => {
      toast.success("Fabricant archivé.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.autoParts.manufacturers });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const countryName = new Map((countries ?? []).map((country) => [country.id, country.name]));

  const columns: Column<Manufacturer>[] = [
    {
      id: "name",
      header: "Fabricant",
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: "country",
      header: "Pays",
      cell: (row) =>
        row.countryId ? (
          (countryName.get(row.countryId) ?? "—")
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "website",
      header: "Site web",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.website || "—"}</span>,
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
            aria-label="Archiver"
            onClick={() => archive.mutate(row.id)}
          >
            <IconTrash className="size-4" />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fabricants"
        description="Équipementiers dont proviennent les pièces (Bosch, Denso, NGK…)."
      >
        {can("auto_parts.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            Nouveau fabricant
          </Button>
        ) : null}
      </PageHeader>

      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucun fabricant"
        emptyDescription="Déclarez vos équipementiers pour pouvoir les affecter aux articles."
      />

      <ManufacturerDialog open={open} onOpenChange={setOpen} countries={countries ?? []} />
    </div>
  );
}

function ManufacturerDialog({
  open,
  onOpenChange,
  countries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  countries: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", countryId: NONE, website: "" });

  const mutation = useMutation({
    mutationFn: () =>
      autoPartsApi.createManufacturer({
        ...form,
        countryId: form.countryId === NONE ? null : form.countryId,
      }),
    onSuccess: () => {
      toast.success("Fabricant créé.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.autoParts.manufacturers });
      onOpenChange(false);
      setForm({ name: "", countryId: NONE, website: "" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau fabricant</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Nom" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              autoFocus
            />
          </Field>
          <Field label="Pays">
            <Select
              value={form.countryId}
              onValueChange={(value) => setForm({ ...form, countryId: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Non renseigné</SelectItem>
                {countries.map((country) => (
                  <SelectItem key={country.id} value={country.id}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Site web">
            <Input
              value={form.website}
              onChange={(event) => setForm({ ...form, website: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.name.trim()}>
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
