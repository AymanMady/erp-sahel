/** Liste des factures clients. */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";

import { INVOICE_STATUSES } from "@shared/schema";
import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { invoicingApi, type InvoiceFilters } from "@/entities/invoicing/api";
import type { InvoiceListItem } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { StatusBadge, statusLabel } from "@/shared/components/status-badge";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/label";

const ALL = "ALL";

export default function InvoicesPage() {
  const [, navigate] = useLocation();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const debounced = useDebounced(search);

  const filters: InvoiceFilters = {
    search: debounced || undefined,
    status: status === ALL ? null : status,
    unpaidOnly: unpaidOnly || undefined,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.invoices(filters),
    queryFn: () => invoicingApi.list(filters),
  });

  const columns: Column<InvoiceListItem>[] = [
    {
      id: "number",
      header: "Numéro",
      cell: (row) => (
        <div>
          <span className="tabular font-medium">{row.number}</span>
          {row.source === "POS" ? (
            <Badge variant="outline" className="ms-2 text-[10px]">
              Caisse
            </Badge>
          ) : null}
        </div>
      ),
    },
    { id: "date", header: "Date", cell: (row) => formatDate(row.date) },
    {
      id: "party",
      header: "Client",
      cell: (row) => <span className="font-medium">{row.partyName}</span>,
    },
    {
      id: "due",
      header: "Échéance",
      hideOnMobile: true,
      cell: (row) => (row.dueDate ? formatDate(row.dueDate) : "—"),
    },
    { id: "status", header: "Statut", cell: (row) => <StatusBadge status={row.status} /> },
    {
      id: "remaining",
      header: "Reste dû",
      align: "end",
      hideOnMobile: true,
      cell: (row) => <Money cents={Math.max(0, row.totalTtcCents - row.paidAmountCents)} />,
    },
    {
      id: "total",
      header: "Total TTC",
      align: "end",
      cell: (row) => <Money cents={row.totalTtcCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Factures clients" description="Documents de vente validés et brouillons.">
        {can("invoicing.write") ? (
          <Button asChild>
            <Link href="/invoices/new">
              <IconPlus className="size-4" />
              Nouvelle facture
            </Link>
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
          placeholder="Numéro ou client…"
          className="sm:max-w-sm"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
        >
          <SelectTrigger className="sm:w-[210px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les statuts</SelectItem>
            {INVOICE_STATUSES.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {statusLabel(entry)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="unpaid" checked={unpaidOnly} onCheckedChange={setUnpaidOnly} />
          <Label htmlFor="unpaid" className="text-sm font-normal">
            Impayées uniquement
          </Label>
        </div>
      </div>

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucune facture"
        emptyDescription="Facturez une commande ou créez une facture directe."
        onRowClick={(row) => navigate(`/invoices/${row.id}`)}
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
        minWidthClassName="min-w-[860px]"
      />
    </div>
  );
}
