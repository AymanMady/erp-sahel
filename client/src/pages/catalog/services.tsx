/** Billable services (labor, flat fees) — [FR-PROD-5]. */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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

/** Translation keys (catalog namespace) for each billing type. */
const BILLING_LABEL_KEYS: Record<string, string> = {
  HOURLY: "services.billing.hourly",
  DAILY: "services.billing.daily",
  FLAT: "services.billing.flat",
};

export default function ServicesPage() {
  const { t } = useTranslation("catalog");
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
      toast.success(t("services.archived"));
      void queryClient.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  const columns: Column<Service>[] = [
    {
      id: "code",
      header: t("common:labels.code"),
      cell: (row) => <span className="tabular font-medium">{row.code}</span>,
    },
    {
      id: "name",
      header: t("services.label"),
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
      header: t("services.billingColumn"),
      hideOnMobile: true,
      cell: (row) => (
        <Badge variant="outline">
          {BILLING_LABEL_KEYS[row.billingType]
            ? t(BILLING_LABEL_KEYS[row.billingType])
            : row.billingType}
        </Badge>
      ),
    },
    {
      id: "vat",
      header: t("services.vat"),
      align: "end",
      hideOnMobile: true,
      cell: (row) => <Rate bp={row.vatRateBp} />,
    },
    {
      id: "price",
      header: t("services.priceExclTax"),
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
              {t("common:actions.edit")}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("common:actions.archive")}
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
      <PageHeader title={t("services.title")} description={t("services.description")}>
        {can("services.write") ? (
          <Button onClick={() => setCreating(true)}>
            <IconPlus className="size-4" />
            {t("services.new")}
          </Button>
        ) : null}
      </PageHeader>

      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage((current) => ({ ...current, offset: 0 }));
        }}
        placeholder={t("services.searchPlaceholder")}
        className="sm:max-w-sm"
      />

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("services.emptyTitle")}
        emptyDescription={t("services.emptyDescription")}
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
  const { t } = useTranslation("catalog");
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
      toast.success(service ? t("services.updated") : t("services.created"));
      void queryClient.invalidateQueries({ queryKey: ["services"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? t("services.editTitle") : t("services.new")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <FieldGrid>
            <Field label={t("common:labels.code")} required>
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                required
                disabled={Boolean(service)}
              />
            </Field>
            <Field label={t("services.billingMode")}>
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
                      {t(BILLING_LABEL_KEYS[type])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <Field label={t("services.label")} required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <FieldGrid>
            <Field label={t("services.priceExclTax")}>
              <MoneyInput
                valueCents={form.priceCents}
                onChange={(cents) => setForm({ ...form, priceCents: cents })}
              />
            </Field>
            <Field label={t("productForm.vatRate")}>
              <RateInput
                valueBp={form.vatRateBp}
                onChange={(bp) => setForm({ ...form, vatRateBp: bp })}
              />
            </Field>
          </FieldGrid>
          <Field label={t("common:labels.description")}>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !form.name.trim() || !form.code.trim()}
            >
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
