/** Liste des devis. */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";

import { QUOTE_STATUSES } from "@shared/schema";
import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { salesApi, type SalesFilters } from "@/entities/sales/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { StatusBadge, statusLabel } from "@/shared/components/status-badge";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import type { Quote } from "@/entities/types";

const ALL = "ALL";

export default function QuotesPage() {
  const [, navigate] = useLocation();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const debounced = useDebounced(search);

  const filters: SalesFilters = {
    search: debounced || undefined,
    status: status === ALL ? null : status,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.quotes(filters),
    queryFn: () => salesApi.listQuotes(filters),
  });

  const columns: Column<Quote & { partyName: string }>[] = [
    {
      id: "number",
      header: "Numéro",
      cell: (row) => <span className="tabular font-medium">{row.number}</span>,
    },
    { id: "date", header: "Date", cell: (row) => formatDate(row.date) },
    {
      id: "party",
      header: "Client",
      cell: (row) => <span className="font-medium">{row.partyName}</span>,
    },
    {
      id: "expiry",
      header: "Validité",
      hideOnMobile: true,
      cell: (row) => (row.expiryDate ? formatDate(row.expiryDate) : "—"),
    },
    { id: "status", header: "Statut", cell: (row) => <StatusBadge status={row.status} /> },
    {
      id: "total",
      header: "Total TTC",
      align: "end",
      cell: (row) => <Money cents={row.totalTtcCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Devis" description="Propositions commerciales en cours et archivées.">
        {can("sales.write") ? (
          <Button asChild>
            <Link href="/quotes/new">
              <IconPlus className="size-4" />
              Nouveau devis
            </Link>
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
          <SelectTrigger className="sm:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les statuts</SelectItem>
            {QUOTE_STATUSES.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {statusLabel(entry)}
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
        emptyTitle="Aucun devis"
        emptyDescription="Créez un devis pour formaliser une proposition avant la commande."
        onRowClick={(row) => navigate(`/quotes/${row.id}`)}
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
      />
    </div>
  );
}
