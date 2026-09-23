/** Prestations facturables (main d'œuvre, forfaits) — [FR-PROD-5]. */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { BILLING_TYPES } from "@shared/schema";
import { errorMessage } from "@/shared/api/api-error";
import { settingsApi } from "@/entities/settings/api";
import type { Service } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { Money, Rate } from "@/shared/components/money";
import { MoneyInput, RateInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

const BILLING_LABELS: Record<string, string> = {
  HOURLY: "À l'heure",
  DAILY: "À la journée",
  FLAT: "Forfait",
};

export default function ServicesPage() {
  const queryClient = useQueryClient();
  const { can, company } = useSession();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebounced(search);

  const filters = { search: debouncedSearch || undefined, ...page };
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.services(filters),
    queryFn: () => settingsApi.listServices(filters),
  });

  const archive = useMutation({
    mutationFn: (id: string) => settingsApi.archiveService(id),
    onSuccess: () => {
      toast.success("Prestation archivée.");
      void queryClient.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const columns: Column<Service>[] = [
    {
      id: "code",
      header: "Code",
      cell: (row) => <span className="tabular font-medium">{row.code}</span>,
    },
    {
      id: "name",
      header: "Libellé",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.description ? (
            <p className="truncate text-xs text-muted-foreground">{row.description}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "billing",
      header: "Facturation",
      hideOnMobile: true,
      cell: (row) => (
        <Badge variant="outline">{BILLING_LABELS[row.billingType] ?? row.billingType}</Badge>
      ),
    },
    {
      id: "vat",
      header: "TVA",
      align: "end",
      hideOnMobile: true,
      cell: (row) => <Rate bp={row.vatRateBp} />,
    },
    {
      id: "price",
      header: "Prix HT",
      align: "end",
      cell: (row) => <Money cents={row.priceCents} />,
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        can("services.write") ? (
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
      <PageHeader title="Prestations" description="Services facturables, sans gestion de stock.">
        {can("services.write") ? (
          <Button onClick={() => setCreating(true)}>
            <IconPlus className="size-4" />
            Nouvelle prestation
          </Button>
        ) : null}
      </PageHeader>

      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage((current) => ({ ...current, offset: 0 }));
        }}
        placeholder="Code ou libellé…"
        className="sm:max-w-sm"
      />

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucune prestation"
        emptyDescription="Déclarez vos forfaits et taux horaires pour les ajouter aux devis et factures."
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
      />

      <ServiceDialog
        open={creating || editing !== null}
        onOpenChange={(value) => {
          if (!value) {
            setCreating(false);
            setEditing(null);
          }
        }}
        service={editing}
        defaultVatRateBp={company?.defaultVatRateBp ?? 0}
      />
    </div>
  );
}

function ServiceDialog({
  open,
  onOpenChange,
  service,
  defaultVatRateBp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service | null;
  defaultVatRateBp: number;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    billingType: "HOURLY" as (typeof BILLING_TYPES)[number],
    priceCents: 0,
    vatRateBp: defaultVatRateBp,
  });

  const key = service?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setForm({
      code: service?.code ?? "",
      name: service?.name ?? "",
      description: service?.description ?? "",
      billingType: (service?.billingType ?? "HOURLY") as (typeof BILLING_TYPES)[number],
      priceCents: service?.priceCents ?? 0,
      vatRateBp: service?.vatRateBp ?? defaultVatRateBp,
    });
  }

  const mutation = useMutation({
    mutationFn: () =>
      service ? settingsApi.updateService(service.id, form) : settingsApi.createService(form),
    onSuccess: () => {
      toast.success(service ? "Prestation mise à jour." : "Prestation créée.");
      void queryClient.invalidateQueries({ queryKey: ["services"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? "Modifier la prestation" : "Nouvelle prestation"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label="Code" required>
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                required
                disabled={Boolean(service)}
              />
            </Field>
            <Field label="Mode de facturation">
              <Select
                value={form.billingType}
                onValueChange={(value) =>
                  setForm({ ...form, billingType: value as (typeof BILLING_TYPES)[number] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {BILLING_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <Field label="Libellé" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <FieldGrid>
            <Field label="Prix HT">
              <MoneyInput
                valueCents={form.priceCents}
                onChange={(cents) => setForm({ ...form, priceCents: cents })}
              />
            </Field>
            <Field label="Taux de TVA">
              <RateInput
                valueBp={form.vatRateBp}
                onChange={(bp) => setForm({ ...form, vatRateBp: bp })}
              />
            </Field>
          </FieldGrid>
          <Field label="Description">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !form.name.trim() || !form.code.trim()}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
