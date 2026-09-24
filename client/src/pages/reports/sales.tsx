/** Sales report: summary, daily series, top items and collections. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { addDays, formatDate, todayInput } from "@shared/format";
import { centsToMajor } from "@shared/money";
import { errorMessage } from "@/shared/api/api-error";
import { reportsApi } from "@/entities/reports/api";
import { currentIntlLocale } from "@/shared/i18n";
import { useDirection } from "@/shared/i18n/direction-provider";
import { queryKeys } from "@/shared/api/query-client";
import { Money, useMoneyFormatter } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { ResourceTable, type Column } from "@/shared/components/resource-table";
import { StatCard } from "@/shared/components/stat-card";
import { paymentMethodLabel } from "@/shared/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";

export default function SalesReportPage() {
  const { t, i18n } = useTranslation("reports");
  const rtl = useDirection() === "rtl";
  const formatMoneyValue = useMoneyFormatter();
  const [fromDate, setFromDate] = useState(addDays(todayInput(), -29));
  const [toDate, setToDate] = useState(todayInput());

  const filters = { fromDate, toDate };
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.reports("sales", filters),
    queryFn: () => reportsApi.sales(filters),
  });

  const chartData = useMemo(
    () =>
      (data?.daily ?? []).map((row) => ({
        label: formatDate(row.date),
        revenue: centsToMajor(row.totalHtCents),
      })),
    // The language is a dependency: date labels follow the UI locale.
    [data, i18n.language]
  );

  type TopRow = NonNullable<typeof data>["topProducts"][number];
  const columns: Column<TopRow>[] = [
    {
      id: "sku",
      header: t("common:labels.reference"),
      cell: (row) => <span className="tabular">{row.productSku || "—"}</span>,
    },
    {
      id: "name",
      header: t("sales.columns.item"),
      cell: (row) => <span className="font-medium">{row.description}</span>,
    },
    {
      id: "quantity",
      header: t("sales.columns.soldQuantity"),
      align: "end",
      cell: (row) => <span className="tabular">{Number(row.quantity)}</span>,
    },
    {
      id: "revenue",
      header: t("sales.revenueExclTax"),
      align: "end",
      cell: (row) => <Money cents={row.revenueCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("sales.title")} description={t("sales.description")}>
        <Input
          type="date"
          aria-label={t("filters.fromDate")}
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
          className="w-[150px]"
        />
        <Input
          type="date"
          aria-label={t("filters.toDate")}
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
          className="w-[150px]"
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("sales.revenueExclTax")}
          value={formatMoneyValue(data?.summary.totalHtCents ?? 0)}
          loading={isLoading}
        />
        <StatCard
          label={t("sales.revenueInclTax")}
          value={formatMoneyValue(data?.summary.totalTtcCents ?? 0)}
          loading={isLoading}
        />
        <StatCard
          label={t("sales.collected")}
          value={formatMoneyValue(data?.summary.paidCents ?? 0)}
          loading={isLoading}
        />
        <StatCard
          label={t("sales.outstanding")}
          value={formatMoneyValue(data?.summary.outstandingCents ?? 0)}
          loading={isLoading}
          invertTrend
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("sales.dailyRevenue")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : chartData.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t("sales.noSales")}</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    reversed={rtl}
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    minTickGap={24}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    width={70}
                    orientation={rtl ? "right" : "left"}
                    tickFormatter={(value: number) =>
                      new Intl.NumberFormat(currentIntlLocale(), { notation: "compact" }).format(
                        value
                      )
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      fontSize: 12,
                    }}
                    formatter={(value) => [
                      formatMoneyValue(Math.round(Number(value ?? 0) * 100)),
                      t("sales.revenueExclTax"),
                    ]}
                  />
                  <Bar dataKey="revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("sales.topSales")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResourceTable
              columns={columns}
              rows={data?.topProducts ?? []}
              rowKey={(row) => `${row.productId}-${row.productSku}`}
              loading={isLoading}
              error={error ? errorMessage(error) : null}
              emptyTitle={t("sales.emptyTitle")}
              emptyDescription={t("sales.emptyDescription")}
              minWidthClassName="min-w-[560px]"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sales.collectionsByMethod")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.collections.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("sales.noCollections")}
              </p>
            ) : (
              data?.collections.map((row) => (
                <div
                  key={row.paymentMethod}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{paymentMethodLabel(row.paymentMethod)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("sales.paymentsCount", { count: row.count })}
                    </p>
                  </div>
                  <Money cents={row.totalCents} className="font-medium" />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
