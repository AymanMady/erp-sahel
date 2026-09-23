/** Liste des tiers (clients, fournisseurs, prospects) avec création rapide. */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";

import { PARTY_TYPES, type PartyType } from "@shared/schema";
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

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "Tous les tiers" },
  ...PARTY_TYPES.map((type) => ({ value: type, label: partyTypeLabel(type) })),
];

export default function PartiesPage() {
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
      header: "Code",
      cell: (row) => <span className="tabular text-sm font-medium">{row.code}</span>,
    },
    {
      id: "name",
      header: "Nom",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.vatNumber ? (
            <p className="text-xs text-muted-foreground">NIF {row.vatNumber}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "type",
      header: "Type",
      cell: (row) => <Badge variant="outline">{partyTypeLabel(row.partyType)}</Badge>,
    },
    {
      id: "contact",
      header: "Contact",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm">
          {row.phone ? <p>{row.phone}</p> : null}
          {row.email ? <p className="text-xs text-muted-foreground">{row.email}</p> : null}
          {!row.phone && !row.email ? <span className="text-muted-foreground">—</span> : null}
        </div>
      ),
    },
    {
      id: "credit",
      header: "Encours autorisé",
      align: "end",
      hideOnMobile: true,
      cell: (row) =>
        row.creditLimitCents > 0 ? (
          <Money cents={row.creditLimitCents} />
        ) : (
          <span className="text-muted-foreground">illimité</span>
        ),
    },
    {
      id: "terms",
      header: "Règlement",
      align: "end",
      hideOnMobile: true,
      cell: (row) =>
        row.paymentTermsDays > 0 ? (
          <span className="tabular text-sm">{row.paymentTermsDays} j</span>
        ) : (
          <span className="text-sm text-muted-foreground">comptant</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Tiers" description="Clients, fournisseurs et prospects de la société.">
        {can("parties.write") ? (
          <Button onClick={() => setCreating(true)}>
            <IconPlus className="size-4" />
            Nouveau tiers
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
          placeholder="Nom, code, téléphone, NIF…"
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
            {TYPE_FILTERS.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
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
        emptyTitle="Aucun tiers"
        emptyDescription="Créez votre premier client ou fournisseur pour commencer à facturer."
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

/** Création d'un tiers. Le code est attribué automatiquement si laissé vide. */
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
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    partyType: defaultType as PartyType,
    email: "",
    phone: "",
    vatNumber: "",
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
      // Hors ligne, le tiers est utilisable aussitôt (devis, facture) sous son
      // identifiant local ; son code définitif sera attribué à la synchronisation.
      const party = outcome.result as Party;
      if (outcome.mode === "online") {
        toast.success(`Tiers « ${party.name} » créé (${party.code}).`);
      } else {
        toast.success(`Tiers « ${party.name} » enregistré hors ligne.`, {
          description: "Il sera créé sur le serveur à la prochaine synchronisation.",
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["parties"] });
      onCreated?.(party);
      onOpenChange(false);
      setForm({
        name: "",
        partyType: defaultType,
        email: "",
        phone: "",
        vatNumber: "",
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
          <DialogTitle>Nouveau tiers</DialogTitle>
          <DialogDescription>
            Le code est généré automatiquement selon le type (CLI, FRN, PSP).
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Nom" htmlFor="party-name" required>
            <Input
              id="party-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              autoFocus
            />
          </Field>

          <FieldGrid>
            <Field label="Type" htmlFor="party-type">
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
            <Field label="Téléphone" htmlFor="party-phone">
              <Input
                id="party-phone"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>
            <Field label="E-mail" htmlFor="party-email">
              <Input
                id="party-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <Field label="Identifiant fiscal" htmlFor="party-vat">
              <Input
                id="party-vat"
                value={form.vatNumber}
                onChange={(event) => setForm({ ...form, vatNumber: event.target.value })}
              />
            </Field>
            <Field label="Encours autorisé" htmlFor="party-credit" hint="0 = aucun plafond">
              <MoneyInput
                id="party-credit"
                valueCents={form.creditLimitCents}
                onChange={(cents) => setForm({ ...form, creditLimitCents: cents })}
              />
            </Field>
            <Field label="Délai de règlement (jours)" htmlFor="party-terms">
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

          <Field label="Notes" htmlFor="party-notes">
            <Textarea
              id="party-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.name.trim()}>
              {mutation.isPending ? "Création…" : "Créer le tiers"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
