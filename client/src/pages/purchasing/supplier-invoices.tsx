/** Supplier invoices: payables. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Link } from "wouter";

import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { purchasingApi } from "@/entities/purchasing/api";
import type { SupplierInvoice } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatusBadge } from "@/shared/components/status-badge";
import { DetailDialog, DetailFields, DetailLines } from "@/shared/components/detail-dialog";
import { documentLineColumns } from "@/features/documents/detail-lines";
import { Button } from "@/shared/ui/button";

export default function SupplierInvoicesPage() {
  const { t } = useTranslation("purchasing");
  const [page] = useState({ limit: 25, offset: 0 });
  const [openId, setOpenId] = useState<string | null>(null);

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
      header: t("common:labels.total"),
      align: "end",
      cell: (row) => <Money cents={row.totalCents} />,
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
        minWidthClassName="md:min-w-[860px]"
        onRowClick={(row) => setOpenId(row.id)}
      />
      <SupplierInvoiceDetailDialog invoiceId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function SupplierInvoiceDetailDialog({
  invoiceId,
  onClose,
}: {
  invoiceId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("purchasing");
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.supplierInvoice(invoiceId ?? ""),
    queryFn: () => purchasingApi.getSupplierInvoice(invoiceId as string),
    enabled: Boolean(invoiceId),
  });

  return (
    <DetailDialog
      open={invoiceId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={data ? t("common:details.supplierInvoiceTitle", { number: data.number }) : ""}
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
              { label: t("supplierInvoices.supplierReference"), value: data.supplierReference },
              { label: t("common:labels.date"), value: formatDate(data.date) },
              {
                label: t("common:labels.dueDate"),
                value: data.dueDate ? formatDate(data.dueDate) : null,
              },
              { label: t("common:details.purchaseOrder"), value: data.purchaseOrderNumber },
              { label: t("common:details.receipt"), value: data.receiptNumber },
              { label: t("common:labels.total"), value: <Money cents={data.totalCents} /> },
              { label: t("common:details.paid"), value: <Money cents={data.paidAmountCents} /> },
              {
                label: t("common:details.remaining"),
                value: <Money cents={Math.max(0, data.totalCents - data.paidAmountCents)} />,
              },
              { label: t("common:labels.notes"), value: data.notes, wide: true },
            ]}
          />
          <DetailLines
            columns={documentLineColumns(t)}
            rows={data.lines}
            rowKey={(line) => line.id}
          />
        </>
      ) : null}
    </DetailDialog>
  );
}
