/** Customer and supplier payments journal. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";

import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { paymentApi, type PaymentFilters } from "@/entities/payment/api";
import type { PaymentRow } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatusBadge, paymentMethodLabel } from "@/shared/components/status-badge";
import { DetailDialog, DetailFields } from "@/shared/components/detail-dialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

/** Only two ways to pay: cash or a banking app. */
const PAYMENT_CHOICES = ["CASH", "MOBILE_MONEY"] as const;
const ALL = "ALL";

export default function PaymentsPage() {
  const { t } = useTranslation("payments");
  const [method, setMethod] = useState(ALL);
  const [direction, setDirection] = useState(ALL);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const [selected, setSelected] = useState<PaymentRow | null>(null);

  const filters: PaymentFilters = {
    method: method === ALL ? null : method,
    direction: direction === ALL ? null : (direction as "IN" | "OUT"),
    fromDate: fromDate || null,
    toDate: toDate || null,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.payments(filters),
    queryFn: () => paymentApi.list(filters),
  });

  const columns: Column<PaymentRow>[] = [
    {
      id: "number",
      header: t("common:labels.number"),
      cell: (row) => <span className="tabular font-medium">{row.number}</span>,
    },
    { id: "date", header: t("common:labels.date"), cell: (row) => formatDate(row.paymentDate) },
    {
      id: "party",
      header: t("columns.party"),
      cell: (row) => <span className="font-medium">{row.partyName}</span>,
    },
    {
      id: "invoice",
      header: t("columns.invoice"),
      hideOnMobile: true,
      cell: (row) =>
        row.invoiceNumber ? (
          <span className="tabular text-sm">{row.invoiceNumber}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "method",
      header: t("columns.method"),
      cell: (row) => <Badge variant="outline">{paymentMethodLabel(row.paymentMethod)}</Badge>,
    },
    {
      id: "account",
      header: t("columns.account"),
      hideOnMobile: true,
      cell: (row) => row.bankAccountName ?? "—",
    },
    {
      id: "amount",
      header: t("common:labels.amount"),
      align: "end",
      cell: (row) => (
        <Money cents={row.direction === "IN" ? row.amountCents : -row.amountCents} tone="auto" />
      ),
    },
  ];

  const totalIn = (data?.items ?? [])
    .filter((row) => row.direction === "IN")
    .reduce((sum, row) => sum + row.amountCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("filters.allDirections")}</SelectItem>
            <SelectItem value="IN">{t("filters.incoming")}</SelectItem>
            <SelectItem value="OUT">{t("filters.outgoing")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("filters.allMethods")}</SelectItem>
            {PAYMENT_CHOICES.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {paymentMethodLabel(entry)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          aria-label={t("common:labels.from")}
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
        />
        <Input
          type="date"
          aria-label={t("common:labels.to")}
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
        />
      </div>

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("empty.title")}
        emptyDescription={t("empty.description")}
        pagination={{
          total: data?.total ?? 0,
          limit: page.limit,
          offset: page.offset,
          onChange: setPage,
        }}
        onRowClick={setSelected}
      />
      <PaymentDetailDialog payment={selected} onClose={() => setSelected(null)} />

      {(data?.items.length ?? 0) > 0 ? (
        <p className="text-end text-sm text-muted-foreground">
          {t("totalInOnPage")} <Money cents={totalIn} className="font-medium text-foreground" />
        </p>
      ) : null}
    </div>
  );
}

function PaymentDetailDialog({
  payment,
  onClose,
}: {
  payment: PaymentRow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("payments");
  return (
    <DetailDialog
      open={payment !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={payment ? t("common:details.paymentTitle", { number: payment.number }) : ""}
      description={payment?.partyName}
      actions={
        payment?.invoiceId ? (
          <Button variant="outline" asChild>
            <Link href={`/invoices/${payment.invoiceId}`}>{t("common:details.openInvoice")}</Link>
          </Button>
        ) : null
      }
    >
      {payment ? (
        <DetailFields
          fields={[
            {
              label: t("common:labels.amount"),
              value: (
                <Money
                  cents={payment.direction === "IN" ? payment.amountCents : -payment.amountCents}
                  tone="auto"
                  className="text-base"
                />
              ),
            },
            {
              label: t("common:details.direction"),
              value:
                payment.direction === "IN"
                  ? t("common:details.incoming")
                  : t("common:details.outgoing"),
            },
            { label: t("common:labels.date"), value: formatDate(payment.paymentDate) },
            { label: t("common:labels.status"), value: <StatusBadge status={payment.status} /> },
            {
              label: t("common:details.method"),
              value: paymentMethodLabel(payment.paymentMethod),
            },
            { label: t("common:details.account"), value: payment.bankAccountName },
            {
              label: t("common:details.invoice"),
              value: payment.invoiceNumber ?? payment.supplierInvoiceNumber,
            },
            { label: t("common:labels.reference"), value: payment.reference },
            { label: t("common:labels.notes"), value: payment.notes, wide: true },
          ]}
        />
      ) : null}
    </DetailDialog>
  );
}
