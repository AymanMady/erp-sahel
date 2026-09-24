/** Supplier invoices: payables and recoverable VAT. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("purchasing");
  const [page] = useState({ limit: 25, offset: 0 });

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.supplierInvoices(page),
    queryFn: () => purchasingApi.listSupplierInvoices(),
  });

  const columns: Column<SupplierInvoice & { supplierName: string }>[] = [
    {
      id: "number",
      header: t("common:labels.number"),
      cell: (row) => <span className="tabular font-medium">{row.number}</span>,
    },
    {
      id: "reference",
      header: t("supplierInvoices.supplierReference"),
      hideOnMobile: true,
      cell: (row) => <span className="tabular text-sm">{row.supplierReference || "—"}</span>,
    },
    { id: "date", header: t("common:labels.date"), cell: (row) => formatDate(row.date) },
    {
      id: "supplier",
      header: t("common:labels.supplier"),
      cell: (row) => <span className="font-medium">{row.supplierName}</span>,
    },
    {
      id: "due",
      header: t("common:labels.dueDate"),
      hideOnMobile: true,
      cell: (row) => (row.dueDate ? formatDate(row.dueDate) : "—"),
    },
    {
      id: "status",
      header: t("common:labels.status"),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: "total",
      header: t("common:labels.totalInclTax"),
      align: "end",
      cell: (row) => <Money cents={row.totalTtcCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("supplierInvoices.title")}
        description={t("supplierInvoices.description")}
      />
      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("supplierInvoices.emptyTitle")}
        emptyDescription={t("supplierInvoices.emptyDescription")}
        minWidthClassName="min-w-[860px]"
      />
    </div>
  );
}
