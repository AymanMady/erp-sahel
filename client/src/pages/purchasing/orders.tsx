/** Liste des commandes fournisseurs. */

import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";

import { PURCHASE_ORDER_STATUSES } from "@shared/schema";
import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { purchasingApi, type PurchaseFilters } from "@/entities/purchasing/api";
import type { PurchaseOrder } from "@/entities/types";
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

const ALL = "ALL";

export default function PurchaseOrdersPage() {
  const [, navigate] = useLocation();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const debounced = useDebounced(search);

  const filters: PurchaseFilters = {
    search: debounced || undefined,
    status: status === ALL ? null : status,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.purchaseOrders(filters),
    queryFn: () => purchasingApi.listOrders(filters),
  });

  const columns: Column<PurchaseOrder & { supplierName: string }>[] = [
    {
      id: "number",
      header: "Numéro",
      cell: (row) => <span className="tabular font-medium">{row.number}</span>,
    },
    { id: "date", header: "Date", cell: (row) => formatDate(row.date) },
    {
      id: "supplier",
      header: "Fournisseur",
      cell: (row) => <span className="font-medium">{row.supplierName}</span>,
    },
    {
      id: "expected",
      header: "Livraison prévue",
      hideOnMobile: true,
      cell: (row) => (row.expectedDate ? formatDate(row.expectedDate) : "—"),
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
      <PageHeader
        title="Commandes fournisseurs"
        description="Approvisionnement : la réception fait entrer la marchandise en stock."
      >
        {can("purchasing.write") ? (
          <Button asChild>
            <Link href="/purchase-orders/new">
              <IconPlus className="size-4" />
              Nouvelle commande
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
          placeholder="Numéro ou fournisseur…"
          className="sm:max-w-sm"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les statuts</SelectItem>
            {PURCHASE_ORDER_STATUSES.map((entry) => (
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
        emptyTitle="Aucune commande d'achat"
        emptyDescription="Créez une commande pour suivre vos approvisionnements."
        onRowClick={(row) => navigate(`/purchase-orders/${row.id}`)}
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
