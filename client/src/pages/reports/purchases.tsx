/** Purchases report over a period. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { addDays, formatDate, todayInput } from "@shared/format";
import { reportsApi } from "@/entities/reports/api";
import { queryKeys } from "@/shared/api/query-client";
import { useMoneyFormatter } from "@/shared/components/money";
import { PageHeader } from "@/shared/components/page-header";
import { StatCard } from "@/shared/components/stat-card";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

export default function PurchasesReportPage() {
  const { t } = useTranslation("reports");
  const formatMoneyValue = useMoneyFormatter();
  const [fromDate, setFromDate] = useState(addDays(todayInput(), -29));
  const [toDate, setToDate] = useState(todayInput());

  const filters = { fromDate, toDate };
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports("purchases", filters),
    queryFn: () => reportsApi.purchases(filters),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("purchases.title")} description={t("purchases.description")}>
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

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("purchases.ordersPlaced")}
          value={data?.summary.orderCount ?? 0}
          loading={isLoading}
        />
        <StatCard
          label={t("purchases.amountExclTax")}
          value={formatMoneyValue(data?.summary.totalHtCents ?? 0)}
          loading={isLoading}
        />
        <StatCard
          label={t("purchases.amountInclTax")}
          value={formatMoneyValue(data?.summary.totalTtcCents ?? 0)}
          loading={isLoading}
        />
      </div>

      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          {t("purchases.periodNote", { from: formatDate(fromDate), to: formatDate(toDate) })}
        </CardContent>
      </Card>
    </div>
  );
}
