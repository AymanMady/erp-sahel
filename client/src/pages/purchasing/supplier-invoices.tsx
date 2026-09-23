/** Factures fournisseurs : dette et TVA récupérable. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { purchasingApi } from "@/entities/purchasing/api";
import type { SupplierInvoice } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatusBadge } from "@/shared/components/status-badge";

export default function SupplierInvoicesPage() {
  const [page] = useState({ limit: 25, offset: 0 });

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.supplierInvoices(page),
    queryFn: () => purchasingApi.listSupplierInvoices(),
  });

  const columns: Column<SupplierInvoice & { supplierName: string }>[] = [
    {
      id: "number",
      header: "Numéro",
      cell: (row) => <span className="tabular font-medium">{row.number}</span>,
    },
    {
      id: "reference",
      header: "Réf. fournisseur",
      hideOnMobile: true,
      cell: (row) => <span className="tabular text-sm">{row.supplierReference || "—"}</span>,
    },
    { id: "date", header: "Date", cell: (row) => formatDate(row.date) },
    {
      id: "supplier",
      header: "Fournisseur",
      cell: (row) => <span className="font-medium">{row.supplierName}</span>,
    },
    {
      id: "due",
      header: "Échéance",
      hideOnMobile: true,
      cell: (row) => (row.dueDate ? formatDate(row.dueDate) : "—"),
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
        title="Factures fournisseurs"
        description="Dettes enregistrées et TVA déductible associée."
      />
      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle="Aucune facture fournisseur"
        emptyDescription="Elles se créent depuis une commande d'achat réceptionnée."
        minWidthClassName="min-w-[860px]"
      />
    </div>
  );
}
