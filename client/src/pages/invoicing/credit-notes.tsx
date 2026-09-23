/** Liste des avoirs émis. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { invoicingApi } from "@/entities/invoicing/api";
import type { CreditNote } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatusBadge } from "@/shared/components/status-badge";
import { Badge } from "@/shared/ui/badge";

export default function CreditNotesPage() {
  const [page, setPage] = useState({ limit: 25, offset: 0 });

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.creditNotes(page),
    queryFn: () => invoicingApi.listCreditNotes(page),
  });

  const columns: Column<CreditNote & { partyName: string }>[] = [
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
      id: "restock",
      header: "Retour en stock",
      hideOnMobile: true,
      cell: (row) =>
        row.restock ? (
          <Badge variant="outline">Réintégré</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">non</span>
        ),
    },
    {
      id: "reason",
      header: "Motif",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.reason || "—"}</span>,
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
        title="Avoirs"
        description="Corrections de factures validées : écriture inverse et retour de stock."
      />
      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucun avoir"
        emptyDescription="Les avoirs s'émettent depuis la fiche d'une facture validée."
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
