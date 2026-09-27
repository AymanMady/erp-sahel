/** Recorded goods receipts. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";

import { formatDate } from "@shared/format";
import { formatQuantity, roundHalfUp } from "@shared/money";
import { errorMessage } from "@/shared/api/api-error";
import { purchasingApi } from "@/entities/purchasing/api";
import type { GoodsReceipt } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatusBadge } from "@/shared/components/status-badge";
import { DetailDialog, DetailFields, DetailLines } from "@/shared/components/detail-dialog";
import { Money } from "@/shared/components/money";
import { Button } from "@/shared/ui/button";

export default function GoodsReceiptsPage() {
  const { t } = useTranslation("purchasing");
  const [openId, setOpenId] = useState<string | null>(null);
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
        onRowClick={(row) => setOpenId(row.id)}
      />
      <ReceiptDetailDialog receiptId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

export function ReceiptDetailDialog({
  receiptId,
  onClose,
}: {
  receiptId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("purchasing");
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.goodsReceipt(receiptId ?? ""),
    queryFn: () => purchasingApi.getReceipt(receiptId as string),
    enabled: Boolean(receiptId),
  });

  type Line = NonNullable<typeof data>["lines"][number];
  const lineTotal = (line: Line) => roundHalfUp(Number(line.quantity) * line.unitCostCents);
  const total = (data?.lines ?? []).reduce((sum, line) => sum + lineTotal(line), 0);

  return (
    <DetailDialog
      open={receiptId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={data ? t("common:details.receiptTitle", { number: data.number }) : ""}
      description={data?.supplierName}
      loading={isLoading}
      error={error ? errorMessage(error) : null}
      actions={
        data?.purchaseOrderId ? (
          <Button variant="outline" asChild>
            <Link href={`/purchase-orders/${data.purchaseOrderId}`}>
              {t("common:details.openOrder")}
            </Link>
          </Button>
        ) : null
      }
    >
      {data ? (
        <>
          <DetailFields
            fields={[
              { label: t("common:labels.status"), value: <StatusBadge status={data.status} /> },
              { label: t("common:labels.date"), value: formatDate(data.date) },
              { label: t("common:details.purchaseOrder"), value: data.purchaseOrderNumber },
              { label: t("common:labels.total"), value: <Money cents={total} /> },
              { label: t("common:labels.notes"), value: data.notes, wide: true },
            ]}
          />
          <DetailLines<Line>
            columns={[
              {
                id: "product",
                header: t("common:labels.product"),
                cell: (line) => (
                  <div className="min-w-0 whitespace-normal">
                    <p className="font-medium">{line.productName || "—"}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {[line.productSku, line.lotNumber].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                ),
              },
              {
                id: "quantity",
                header: t("common:labels.quantity"),
                align: "end",
                cell: (line) => <span className="tabular">{formatQuantity(line.quantity)}</span>,
              },
              {
                id: "unitCost",
                header: t("common:details.unitCost"),
                align: "end",
                cell: (line) => <Money cents={line.unitCostCents} />,
              },
              {
                id: "total",
                header: t("common:labels.total"),
                align: "end",
                cell: (line) => <Money cents={lineTotal(line)} className="font-medium" />,
              },
            ]}
            rows={data.lines}
            rowKey={(line) => line.id}
          />
        </>
      ) : null}
    </DetailDialog>
  );
}
