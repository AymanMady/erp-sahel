/** Bons de réception enregistrés. */

import { useQuery } from "@tanstack/react-query";

import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { purchasingApi } from "@/entities/purchasing/api";
import type { GoodsReceipt } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatusBadge } from "@/shared/components/status-badge";

export default function GoodsReceiptsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.goodsReceipts(),
    queryFn: () => purchasingApi.listReceipts(),
  });

  const columns: Column<GoodsReceipt & { supplierName: string }>[] = [
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
    { id: "status", header: "Statut", cell: (row) => <StatusBadge status={row.status} /> },
    {
      id: "notes",
      header: "Notes",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.notes || "—"}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Réceptions"
        description="Chaque réception validée crée les mouvements d'entrée en stock."
      />
      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucune réception"
        emptyDescription="Les réceptions se saisissent depuis une commande fournisseur."
      />
    </div>
  );
}
