/** Sales order list. */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

import { SALES_ORDER_STATUSES } from "@shared/schema";
import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { salesApi, type SalesFilters } from "@/entities/sales/api";
import type { SalesOrder } from "@/entities/types";
import { queryKeys } from "@/shared/api/query-client";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { StatusBadge, statusLabel } from "@/shared/components/status-badge";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const ALL = "ALL";

export default function SalesOrdersPage() {
  const { t } = useTranslation("sales");
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState({ limit: 25, offset: 0 });
  const debounced = useDebounced(search);

  const filters: SalesFilters = {
    search: debounced || undefined,
    status: status === ALL ? null : status,
    ...page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.salesOrders(filters),
    queryFn: () => salesApi.listOrders(filters),
  });

  const columns: Column<SalesOrder & { partyName: string }>[] = [
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
      id: "delivery",
      header: t("orders.columns.delivery"),
      hideOnMobile: true,
      cell: (row) => (row.deliveryDate ? formatDate(row.deliveryDate) : "—"),
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
      <PageHeader title={t("orders.title")} description={t("orders.description")} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
          placeholder={t("searchPlaceholder")}
          className="sm:max-w-sm"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage((current) => ({ ...current, offset: 0 }));
          }}
        >
          <SelectTrigger className="sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
            {SALES_ORDER_STATUSES.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {statusLabel(entry)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ResourceTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? errorMessage(error) : null}
        emptyTitle={t("orders.emptyTitle")}
        emptyDescription={t("orders.emptyDescription")}
        onRowClick={(row) => navigate(`/sales-orders/${row.id}`)}
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
