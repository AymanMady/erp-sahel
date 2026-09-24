/** Recorded goods receipts. */

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { purchasingApi } from "@/entities/purchasing/api";
import type { GoodsReceipt } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatusBadge } from "@/shared/components/status-badge";

export default function GoodsReceiptsPage() {
  const { t } = useTranslation("purchasing");
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.goodsReceipts(),
    queryFn: () => purchasingApi.listReceipts(),
  });

  const columns: Column<GoodsReceipt & { supplierName: string }>[] = [
    {
      id: "number",
      header: t("common:labels.number"),
      cell: (row) => <span className="tabular font-medium">{row.number}</span>,
    },
    { id: "date", header: t("common:labels.date"), cell: (row) => formatDate(row.date) },
    {
      id: "supplier",
      header: t("common:labels.supplier"),
      cell: (row) => <span className="font-medium">{row.supplierName}</span>,
    },
    {
      id: "status",
      header: t("common:labels.status"),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: "notes",
      header: t("common:labels.notes"),
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.notes || "—"}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("receipts.title")} description={t("receipts.description")} />
      <ResourceTable
        columns={columns}
        rows={data ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("receipts.emptyTitle")}
        emptyDescription={t("receipts.emptyDescription")}
      />
    </div>
  );
}
