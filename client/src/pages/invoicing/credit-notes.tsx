/** Issued credit note list. */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { invoicingApi } from "@/entities/invoicing/api";
import type { CreditNote } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatusBadge } from "@/shared/components/status-badge";
import { DetailDialog, DetailFields, DetailLines } from "@/shared/components/detail-dialog";
import { documentLineColumns } from "@/features/documents/detail-lines";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

export default function CreditNotesPage() {
  const { t } = useTranslation("invoicing");
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.creditNotes(page),
    queryFn: () => invoicingApi.listCreditNotes(page),
  });

  const columns: Column<CreditNote & { partyName: string }>[] = [
    {
      id: "number",
      header: t("common:labels.number"),
      cell: (row) => <span className="tabular font-medium">{row.number}</span>,
    },
    { id: "date", header: t("common:labels.date"), cell: (row) => formatDate(row.date) },
    {
      id: "party",
      header: t("common:labels.customer"),
      cell: (row) => <span className="font-medium">{row.partyName}</span>,
    },
    {
      id: "restock",
      header: t("creditNotes.columns.restock"),
      hideOnMobile: true,
      cell: (row) =>
        row.restock ? (
          <Badge variant="outline">{t("creditNotes.restocked")}</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">{t("creditNotes.notRestocked")}</span>
        ),
    },
    {
      id: "reason",
      header: t("creditNotes.columns.reason"),
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.reason || "—"}</span>,
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
      <PageHeader title={t("creditNotes.title")} description={t("creditNotes.description")} />
      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("creditNotes.emptyTitle")}
        emptyDescription={t("creditNotes.emptyDescription")}
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
        onRowClick={(row) => setOpenId(row.id)}
      />
      <CreditNoteDetailDialog creditNoteId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function CreditNoteDetailDialog({
  creditNoteId,
  onClose,
}: {
  creditNoteId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("invoicing");
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.creditNote(creditNoteId ?? ""),
    queryFn: () => invoicingApi.getCreditNote(creditNoteId as string),
    enabled: Boolean(creditNoteId),
  });

  return (
    <DetailDialog
      open={creditNoteId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={data ? t("common:details.creditNoteTitle", { number: data.number }) : ""}
      description={data?.partyName}
      loading={isLoading}
      error={error ? errorMessage(error) : null}
      actions={
        data?.invoiceId ? (
          <Button variant="outline" asChild>
            <Link href={`/invoices/${data.invoiceId}`}>{t("common:details.openInvoice")}</Link>
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
              { label: t("common:details.invoice"), value: data.invoiceNumber },
              {
                label: t("common:details.restock"),
                value: data.restock ? t("common:states.yes") : t("common:states.no"),
              },
              { label: t("common:labels.total"), value: <Money cents={data.totalCents} /> },
              { label: t("common:details.reason"), value: data.reason, wide: true },
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
