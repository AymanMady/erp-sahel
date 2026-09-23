/** Rapport des ventes : synthèse, série quotidienne, top articles et encaissements. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { addDays, formatDate, todayInput } from "@shared/format";
import { centsToMajor } from "@shared/money";
import { errorMessage } from "@/shared/api/api-error";
import { reportsApi } from "@/entities/reports/api";
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
        ca: centsToMajor(row.totalHtCents),
      })),
    [data]
  );

  type TopRow = NonNullable<typeof data>["topProducts"][number];
  const columns: Column<TopRow>[] = [
    {
      id: "sku",
      header: "Référence",
      cell: (row) => <span className="tabular">{row.productSku || "—"}</span>,
    },
    {
      id: "name",
      header: "Article",
      cell: (row) => <span className="font-medium">{row.description}</span>,
    },
    {
      id: "quantity",
      header: "Quantité vendue",
      align: "end",
      cell: (row) => <span className="tabular">{Number(row.quantity)}</span>,
    },
    {
      id: "revenue",
      header: "CA HT",
      align: "end",
      cell: (row) => <Money cents={row.revenueCents} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rapport des ventes"
        description="Chiffre d'affaires, articles et encaissements."
      >
        <Input
          type="date"
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
          className="w-[150px]"
        />
        <Input
          type="date"
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
          className="w-[150px]"
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="CA HT"
          value={formatMoneyValue(data?.summary.totalHtCents ?? 0)}
          loading={isLoading}
        />
        <StatCard
          label="CA TTC"
          value={formatMoneyValue(data?.summary.totalTtcCents ?? 0)}
          loading={isLoading}
        />
        <StatCard
          label="Encaissé"
          value={formatMoneyValue(data?.summary.paidCents ?? 0)}
          loading={isLoading}
        />
        <StatCard
          label="Restant dû"
          value={formatMoneyValue(data?.summary.outstandingCents ?? 0)}
          loading={isLoading}
          invertTrend
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Chiffre d'affaires quotidien</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : chartData.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Aucune vente sur la période.
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
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
                    tickFormatter={(value: number) =>
                      new Intl.NumberFormat("fr-FR", { notation: "compact" }).format(value)
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
                      "CA HT",
                    ]}
                  />
                  <Bar dataKey="ca" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Meilleures ventes</CardTitle>
          </CardHeader>
          <CardContent>
            <ResourceTable
              columns={columns}
              rows={data?.topProducts ?? []}
              rowKey={(row) => `${row.productId}-${row.productSku}`}
              loading={isLoading}
              error={error ? errorMessage(error) : null}
              emptyTitle="Aucune vente"
              emptyDescription="Aucun article vendu sur la période."
              minWidthClassName="min-w-[560px]"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Encaissements par mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.collections.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Aucun encaissement sur la période.
              </p>
            ) : (
              data?.collections.map((row) => (
                <div
                  key={row.paymentMethod}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{paymentMethodLabel(row.paymentMethod)}</p>
                    <p className="text-xs text-muted-foreground">{row.count} règlement(s)</p>
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
