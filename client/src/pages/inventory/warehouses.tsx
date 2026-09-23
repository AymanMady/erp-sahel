/** Magasins et points de vente de la société. */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "@/shared/api/api-error";
import { inventoryApi } from "@/entities/inventory/api";
import type { Warehouse } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field } from "@/shared/components/field";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

export default function WarehousesPage() {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => inventoryApi.listWarehouses(),
  });

  const archive = useMutation({
    mutationFn: (id: string) => inventoryApi.archiveWarehouse(id),
    onSuccess: () => {
      toast.success("Magasin archivé.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.warehouses });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const columns: Column<Warehouse>[] = [
    {
      id: "code",
      header: "Code",
      cell: (row) => <span className="tabular font-medium">{row.code}</span>,
    },
    {
      id: "name",
      header: "Nom",
      cell: (row) => (
        <span className="font-medium">
          {row.name}
          {row.isDefault ? (
            <Badge variant="outline" className="ms-2 text-[10px]">
              par défaut
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: "address",
      header: "Adresse",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.address || "—"}</span>,
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        can("settings.write") ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
              Modifier
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Archiver"
              onClick={() => archive.mutate(row.id)}
            >
              <IconTrash className="size-4" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Magasins" description="Emplacements physiques où le stock est détenu.">
        {can("settings.write") ? (
          <Button onClick={() => setOpen(true)}>
            <IconPlus className="size-4" />
            Nouveau magasin
          </Button>
        ) : null}
      </PageHeader>

      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucun magasin"
        emptyDescription="Au moins un magasin est nécessaire pour valider une facture."
      />

      <WarehouseDialog
        open={open || editing !== null}
        onOpenChange={(value) => {
          if (!value) {
            setOpen(false);
            setEditing(null);
          }
        }}
        warehouse={editing}
      />
    </div>
  );
}

function WarehouseDialog({
  open,
  onOpenChange,
  warehouse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: Warehouse | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: "", name: "", address: "", isDefault: false });

  const key = warehouse?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setForm({
      code: warehouse?.code ?? "",
      name: warehouse?.name ?? "",
      address: warehouse?.address ?? "",
      isDefault: warehouse?.isDefault ?? false,
    });
  }

  const mutation = useMutation({
    mutationFn: () =>
      warehouse
        ? inventoryApi.updateWarehouse(warehouse.id, form)
        : inventoryApi.createWarehouse(form),
    onSuccess: () => {
      toast.success(warehouse ? "Magasin mis à jour." : "Magasin créé.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.warehouses });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{warehouse ? "Modifier le magasin" : "Nouveau magasin"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Code" required>
            <Input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              required
              disabled={Boolean(warehouse)}
              className="tabular"
            />
          </Field>
          <Field label="Nom" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label="Adresse">
            <Textarea
              rows={2}
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.isDefault}
              onCheckedChange={(checked) => setForm({ ...form, isDefault: checked === true })}
            />
            Magasin par défaut des documents
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !form.code.trim() || !form.name.trim()}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
