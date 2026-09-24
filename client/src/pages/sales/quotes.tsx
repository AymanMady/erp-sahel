/** Quote list. */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";

import { QUOTE_STATUSES } from "@shared/schema";
import { formatDate } from "@shared/format";
import { errorMessage } from "@/shared/api/api-error";
import { salesApi, type SalesFilters } from "@/entities/sales/api";
import { queryKeys } from "@/shared/api/query-client";
import { useSession } from "@/shared/auth/session";
import { Money } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { SearchInput } from "@/shared/components/search-input";
import { StatusBadge, statusLabel } from "@/shared/components/status-badge";
import { useDebounced } from "@/shared/hooks/use-debounced";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import type { Quote } from "@/entities/types";

const ALL = "ALL";

export default function QuotesPage() {
  const { t } = useTranslation("sales");
  const [, navigate] = useLocation();
  const { can } = useSession();
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
    queryKey: queryKeys.quotes(filters),
    queryFn: () => salesApi.listQuotes(filters),
  });

  const columns: Column<Quote & { partyName: string }>[] = [
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
      id: "expiry",
      header: t("quotes.columns.expiry"),
      hideOnMobile: true,
      cell: (row) => (row.expiryDate ? formatDate(row.expiryDate) : "—"),
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
      <PageHeader title={t("quotes.title")} description={t("quotes.description")}>
        {can("sales.write") ? (
          <Button asChild>
            <Link href="/quotes/new">
              <IconPlus className="size-4" />
              {t("quotes.new")}
            </Link>
          </Button>
        ) : null}
      </PageHeader>

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
          <SelectTrigger className="sm:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
            {QUOTE_STATUSES.map((entry) => (
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
        emptyTitle={t("quotes.emptyTitle")}
        emptyDescription={t("quotes.emptyDescription")}
        onRowClick={(row) => navigate(`/quotes/${row.id}`)}
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
