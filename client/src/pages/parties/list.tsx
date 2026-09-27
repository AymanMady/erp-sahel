/** Parties list (customers, suppliers, prospects) with quick creation. */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { toast } from "sonner";

import { PARTY_TYPES, type PartyType } from "@shared/schema";
import { isValidPhone } from "@shared/phone";
import { errorMessage } from "@/shared/api/api-error";
import { partyApi, type PartyFilters } from "@/entities/party/api";
import { onlineOrQueued, queuePartyCreate } from "@/shared/offline/offline-writes";
import type { Party } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Field, FieldGrid } from "@/shared/components/field";
import { Money } from "@/shared/components/money";
import { MoneyInput } from "@/shared/components/money-input";
import { PageHeader } from "@/shared/components/page-header";
import { PhoneField } from "@/shared/components/phone-field";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { partyTypeLabel } from "@/shared/components/status-badge";
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
import { Textarea } from "@/shared/ui/textarea";

export default function PartiesPage() {
  const { t } = useTranslation("parties");
  const [, navigate] = useLocation();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [partyType, setPartyType] = useState("ALL");
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebounced(search);

  const filters: PartyFilters = {
    search: debouncedSearch || undefined,
    partyType: partyType === "ALL" ? null : partyType,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.parties(filters),
    queryFn: () => partyApi.list(filters),
  });

  const columns: Column<Party>[] = [
    {
      id: "code",
      header: t("common:labels.code"),
      cell: (row) => <span className="tabular text-sm font-medium">{row.code}</span>,
    },
    {
      id: "name",
      header: t("common:labels.name"),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
        </div>
      ),
    },
    {
      id: "type",
      header: t("common:labels.type"),
      cell: (row) => <Badge variant="outline">{partyTypeLabel(row.partyType)}</Badge>,
    },
    {
      id: "contact",
      header: t("list.columns.contact"),
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm">
          {row.phone ? <p>{row.phone}</p> : <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      id: "credit",
      header: t("fields.creditLimit"),
      align: "end",
      hideOnMobile: true,
      cell: (row) =>
        row.creditLimitCents > 0 ? (
          <Money cents={row.creditLimitCents} />
        ) : (
          <span className="text-muted-foreground">{t("list.unlimited")}</span>
        ),
    },
    {
      id: "terms",
      header: t("list.columns.paymentTerms"),
      align: "end",
      hideOnMobile: true,
      cell: (row) =>
        row.paymentTermsDays > 0 ? (
          <span className="tabular text-sm">
            {t("detail.termsDays", { count: row.paymentTermsDays })}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{t("list.cash")}</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("list.title")} description={t("list.description")}>
        {can("parties.write") ? (
          <Button onClick={() => setCreating(true)}>
            <IconPlus className="size-4" />
            {t("list.new")}
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
          placeholder={t("list.searchPlaceholder")}
          className="sm:max-w-sm"
        />
        <Select
          value={partyType}
          onValueChange={(value) => {
            setPartyType(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
        >
          <SelectTrigger className="sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("list.allTypes")}</SelectItem>
            {PARTY_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {partyTypeLabel(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("list.empty.title")}
        emptyDescription={t("list.empty.description")}
        onRowClick={(row) => navigate(`/parties/${row.id}`)}
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
      />

      <PartyDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** Party creation. The code is assigned automatically when left empty. */
export function PartyDialog({
  open,
  onOpenChange,
  onCreated,
  defaultType = "CUSTOMER",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (party: Party) => void;
  defaultType?: PartyType;
}) {
  const { t } = useTranslation("parties");
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    partyType: defaultType as PartyType,
    phone: "",
    creditLimitCents: 0,
    paymentTermsDays: 0,
    notes: "",
  });

  const mutation = useMutation({
    mutationFn: () =>
      onlineOrQueued(
        () => partyApi.create(form),
        () => queuePartyCreate(form)
      ),
    onSuccess: (outcome) => {
      // Offline, the party is usable immediately (quote, invoice) under its local
      // id; its final code will be assigned during synchronization.
      const party = outcome.result as Party;
      if (outcome.mode === "online") {
        toast.success(t("create.created", { name: party.name, code: party.code }));
      } else {
        toast.success(t("create.savedOffline", { name: party.name }), {
          description: t("create.savedOfflineDescription"),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["parties"] });
      onCreated?.(party);
      onOpenChange(false);
      setForm({
        name: "",
        partyType: defaultType,
        phone: "",
        creditLimitCents: 0,
        paymentTermsDays: 0,
        notes: "",
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label={t("common:labels.name")} htmlFor="party-name" required>
            <Input
              id="party-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              autoFocus
            />
          </Field>

          <FieldGrid>
            <Field label={t("common:labels.type")} htmlFor="party-type">
              <Select
                value={form.partyType}
                onValueChange={(value) => setForm({ ...form, partyType: value as PartyType })}
              >
                <SelectTrigger id="party-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {partyTypeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <PhoneField
              id="party-phone"
              value={form.phone}
              onChange={(phone) => setForm({ ...form, phone })}
            />
            <Field
              label={t("fields.creditLimit")}
              htmlFor="party-credit"
              hint={t("fields.creditLimitHint")}
            >
              <MoneyInput
                id="party-credit"
                valueCents={form.creditLimitCents}
                onChange={(cents) => setForm({ ...form, creditLimitCents: cents })}
              />
            </Field>
            <Field label={t("fields.paymentTermsDays")} htmlFor="party-terms">
              <Input
                id="party-terms"
                type="number"
                min={0}
                max={365}
                className="tabular text-end"
                value={form.paymentTermsDays}
                onChange={(event) =>
                  setForm({ ...form, paymentTermsDays: Number(event.target.value) || 0 })
                }
              />
            </Field>
          </FieldGrid>

          <Field label={t("common:labels.notes")} htmlFor="party-notes">
            <Textarea
              id="party-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !form.name.trim() || !isValidPhone(form.phone)}
            >
              {mutation.isPending ? t("create.creating") : t("create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
