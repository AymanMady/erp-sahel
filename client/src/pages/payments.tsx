/** Customer and supplier payments journal. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { PAYMENT_METHODS } from "@shared/schema";
import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { paymentApi, type PaymentFilters } from "@/entities/payment/api";
import type { PaymentRow } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { paymentMethodLabel } from "@/shared/components/status-badge";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const ALL = "ALL";

export default function PaymentsPage() {
  const { t } = useTranslation("payments");
  const [method, setMethod] = useState(ALL);
  const [direction, setDirection] = useState(ALL);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState({ limit: 25, offset: 0 });

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
            {PAYMENT_METHODS.map((entry) => (
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
      />

      {(data?.items.length ?? 0) > 0 ? (
        <p className="text-end text-sm text-muted-foreground">
          {t("totalInOnPage")} <Money cents={totalIn} className="font-medium text-foreground" />
        </p>
      ) : null}
    </div>
  );
}
